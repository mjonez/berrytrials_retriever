var express = require('express');
var path = require('path');
var fs = require('fs');
//var bodyParser = require('body-parser');
var app = express();
var jsonfile = require('jsonfile');
const constants = require('./constants');
var pool = require('./database');

app.use(function (req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

app.use('/css', express.static(__dirname + '/css'));
app.use('/js', express.static(__dirname + '/js'));
app.use('/img', express.static(__dirname + '/img'));

app.set('view engine', 'ejs');
//app.use(bodyParser.json());

app.get('/', async function (req, res) {
  var topRuns = await getTopRunsForAllZones();
  var activePlayers = await getActivePlayers();
  res.render('index', {
    'topRuns': topRuns,
    'activePlayers': activePlayers,
    'zones': constants.ZONES
  });
});

async function getTopRunsForAllZones() {
  var zones = constants.ZONES;
  var topRuns = {};
  for(var i = 0; i < zones.length; i++) {
    topRuns[zones[i]] = await getTopRunsZone(zones[i]);
  }
  return topRuns;
}

async function getTopRunsZone(zone) {
  var excludedGuidQueryText = "";
  if(constants.TOP_RUNS_EXCLUDED_GUIDS.length > 0) {
    for(var i = 0; i < constants.TOP_RUNS_EXCLUDED_GUIDS.length; i++) {
      var eg = constants.TOP_RUNS_EXCLUDED_GUIDS[i];
      excludedGuidQueryText += " AND guid != '" + eg + "'";
    }
  }
  var query = "SELECT * FROM `players` where " + zone + " != 0" + excludedGuidQueryText + " ORDER BY ABS(" + zone + ") ASC LIMIT 3";
  try {
    var result = await pool.query(query);
    if (result.length < 3) {
      console.log("ERROR: Less than 3 top runs found for zone: " + zone);
    } else {
      return result;
    }
  } 
  catch (err) {
    throw new Error(err);
  }
}

async function getActivePlayers() {
  var query = "SELECT * FROM `players` INNER JOIN `active_players` ON players.guid = active_players.guid";
  try {
    var result = await pool.query(query);
    return result;
  } 
  catch (err) {
    throw new Error(err);
  }
}

app.get('/api/getChatLog', function (req, res) {
  var query = "SELECT * FROM `chatlog` ORDER BY `occurred` DESC";
  if(req.query.limit) {
    try {
      var limit = parseInt(req.query.limit.trim());
      // check limit is number
      if(!isNaN(limit)) {
        query += " LIMIT " + limit;
      }
    } catch (e) {
      console.log("ERROR [/api/getChatLog]: Cannot Parse Limit as Integer", limit);
    }
  }
  pool.query(query, (err, result) => {
    if (err) {
      console.log("ERROR: Cannot retrieve messages from database", err);
    } else {
      res.json(result);
    }
  });
});

app.listen(4200, function () {
  console.log("Express server listening on port 4200");
});