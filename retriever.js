const jsonfile = require('jsonfile');
const lineReader = require('line-reader');
const fs = require('fs');
const Path = require('path');
const axios = require('axios');
const constants = require('./constants');
const useful = require('./useful');
const LineByLineReader = require('line-by-line');
const geoip = require('geoip-lite');
const {
  getName
} = require('country-list');
const mysql = require('mysql');
const moment = require('moment');
const snooze = ms => new Promise(resolve => setTimeout(resolve, ms));


async function downloadEnterleave() {
  const url = 'http://berrytrials.me:4180/cod4/mods/berry_promod/enterleave.log';
  const path = Path.resolve(__dirname, 'logs', 'enterleave.log');
  const writer = fs.createWriteStream(path);

  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream'
  });

  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

async function downloadServer_log() {
  const url = 'http://berrytrials.me:4180/cod4/mods/berry_promod/server_log.txt';
  const path = Path.resolve(__dirname, 'logs', 'server_log.txt');
  const writer = fs.createWriteStream(path);

  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream'
  });

  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

// create connection to database
const db = mysql.createConnection({
  host: constants.MYSQL_H,
  user: constants.MYSQL_U,
  password: constants.MYSQL_P,
  database: constants.MYSQL_D,
});
// connect to database
db.connect((err) => {
  if (err) {
    throw err;
  }
  console.log('Connected to berrytrials database');
  downloadAndRead();
  setInterval(function () {
    downloadAndRead();
  }, 30000);
});
global.db = db;

async function downloadAndRead() {
  await downloadLogs();
  readInfo();
}

async function downloadLogs() {
  await downloadEnterleave();
  await downloadServer_log();
  console.log("Finished downloading log files");
}

function readInfo() {
  var guidIp = {};

  console.log("Reading enterleave.log");
  lr = new LineByLineReader(constants.ENTERLEAVE_PATH);
  lr.on('line', function (line) {
    lr.pause();
    var i = line.indexOf(" ^5entered this server");
    // line contains port so it's a client entering/leaving
    if (i >= 0) {
      var firstHalf = line.substring(0, i);
      var firstHalfSplitColon = firstHalf.split(":");
      if (firstHalfSplitColon.length >= 2) {
        var firstHalfSplit = firstHalfSplitColon[firstHalfSplitColon.length - 2].split(" ");
        if (firstHalfSplit.length > 0) {
          var ip = firstHalfSplit[firstHalfSplit.length - 1];
          // now get guid
          var lineSplit = line.split(" ");
          if (lineSplit.length > 0) {
            var guid = lineSplit[lineSplit.length - 1];
            guidIp[guid] = ip;
          }
        }
      }
    }
    lr.resume();
  });

  // Finished reading enterleave.log so we have collected ip addresses, now read server_log
  lr.on('end', function () {
    //console.log("Finished reading enterleave.log" + "\n");
    console.log("Reading server_log.txt");
    var playerInfoJson = false;
    var runInfoJson = false;
    var runs = [];
    var activePlayers = [];
    var oldActivePlayers = [];
    var messages = [];
    lr = new LineByLineReader(constants.SERVER_LOG_PATH);
    var lineCount = 0;
    var line2 = "";
    lr.on('line', function (line) {
      lr.pause();
      lineCount++;
      if (lineCount == 2) {
        line2 = line;
      }
      // for chatlog
      if (line.includes(" say;") || line.includes(" say_team;") || line.includes(" say_special;")) {
        var msgType = "say";
        if (line.includes(" say_team;")) {
          msgType = "say_team";
        } else if (line.includes(" say_special;")) {
          msgType = "say_special";
        }
        try {
          var cSplit = line.split(";");
          var guid = cSplit[1];
          var name = cSplit[3];
          var preLength = 0;
          if (line.startsWith(";")) {
            preLength += 1;
          }
          preLength = (cSplit[0] + ";" + cSplit[1] + ";" + cSplit[2] + ";" + cSplit[3] + ";").length;
          var message = line.substring(preLength).trim();
          var firstChar = "" + message.charAt(0);
          // delete first non-alphanumeric char
          if (firstChar.length > 0 && !useful.alphanumeric(firstChar)) {
            if (message.length > 1) {
              message = message.substring(1);
            }
          }

          // to ensure no two messages have the same timestamp, increment w/ message array length
          var timeStamp = (Number(moment().format('x')) + Number(messages.length)) + "";
          var inServerGuids = "";
          for (var i = 0; i < activePlayers.length; i++) {
            inServerGuids += activePlayers[i].guid + " ";
          }
          inServerGuids = inServerGuids.trim();
          var hash = useful.md5HashString(line + line2);
          // create message object
          var messageObj = {};
          messageObj.message = message;
          messageObj.guid = guid;
          messageObj.name = name;
          messageObj.occurred = timeStamp;
          messageObj.type = msgType;
          messageObj.inServer = inServerGuids;
          messageObj.hash = hash;
          messages.push(messageObj);
          //console.log("messageObj", messageObj)
        } catch (e) {
          console.log("ERROR: Cannot Parse Message", line);
        }
      }

      // player json saving mode and json object detected
      if (playerInfoJson && line.startsWith("{'guid': '")) {
        // preserve newlines, remove non-printable and other non-valid JSON chars, convert ' to "
        var jsonLine = line.replace(/\\n/g, "\\n")
          .replace(/\\'/g, "\\'")
          .replace(/\\"/g, '\\"')
          .replace(/\\&/g, "\\&")
          .replace(/\\r/g, "\\r")
          .replace(/\\t/g, "\\t")
          .replace(/\\b/g, "\\b")
          .replace(/\\f/g, "\\f")
          .replace(/[\u0000-\u0019]+/g, "")
          .replace(/'/g, '"');
        try {
          var playerObj = JSON.parse(jsonLine);
          activePlayers.push(playerObj);
        } catch (e) {
          console.log("ERROR: Cannot Parse Player JSON", jsonLine);
          // add players from old active players to new active players
          for(var i = 0; i < oldActivePlayers.length; i++) {
            var activeGuid = oldActivePlayers[i].guid;
            var isAlreadyAdded = false;
            for(var j = 0; j < activePlayers.length; j++) {
              if(activePlayers[j].guid == activeGuid) {
                isAlreadyAdded = true;
                break;
              }
            }
            if(!isAlreadyAdded) {
              activePlayers.push(oldActivePlayers[i]);
            }
          }
        }
      }

      // run json saving mode and json object detected
      if (runInfoJson && line.startsWith("{'uniqId': '")) {
        // preserve newlines, remove non-printable and other non-valid JSON chars, convert ' to "
        var jsonLine = line.replace(/\\n/g, "\\n")
          .replace(/\\'/g, "\\'")
          .replace(/\\"/g, '\\"')
          .replace(/\\&/g, "\\&")
          .replace(/\\r/g, "\\r")
          .replace(/\\t/g, "\\t")
          .replace(/\\b/g, "\\b")
          .replace(/\\f/g, "\\f")
          .replace(/[\u0000-\u0019]+/g, "")
          .replace(/'/g, '"');
        try {
          var runObj = JSON.parse(jsonLine);
          runObj.occurred = moment().format('x');
          runs.push(runObj);
        } catch (e) {
          console.log("ERROR: Cannot Run JSON", jsonLine);
        }
      }

      // line contains [playerinfojson] so enable json saving mode, reset active player list (since players are about to be added)
      if (line.indexOf("[playerinfojson]") >= 0) {
        playerInfoJson = true;
        oldActivePlayers = activePlayers.slice(0);
        activePlayers = [];
      }
      // line contains [/playerinfojson] so disable json saving mode
      else if (line.indexOf("[/playerinfojson]") >= 0) {
        playerInfoJson = false;
      }

      // line contains [runinfojson] so enable json saving mode
      if (line.indexOf("[runinfojson]") >= 0) {
        runInfoJson = true;
      }
      // line contains [/runinfojson] so disable json saving mode
      else if (line.indexOf("[/runinfojson]") >= 0) {
        runInfoJson = false;
      }
      lr.resume();
    });

    lr.on('end', function () {
      //console.log("Finished reading server_log.txt");

      // add messages to chatlog
      updateChatlog(messages);

      // add runs
      updateServerRuns(runs);

      // now process active players (add to db)
      //console.log("Active players", activePlayers);
      //var timeStamp = moment().format('Do MMMM YYYY, HH:mm:ss') + " & " + moment().format('x');
      var timeStamp = moment().format('x');
      for (var i = 0; i < activePlayers.length; i++) {
        var player = activePlayers[i];
        var countrycode = "N/A";
        var city = "N/A";
        var country = "N/A";
        var latlong = "N/A";
        var ip = guidIp[player.guid];
        if (ip) {
          try {
            var geoInfo = geoip.lookup(ip);
            latlong = geoInfo.ll[0] + ", " + geoInfo.ll[1];
            countrycode = geoInfo.country;
            city = geoInfo.city;
            country = getName(countrycode);
            // update player obj w/ new fields
            player.ip = ip;
            player.country = country;
            player.countrycode = countrycode;
            player.city = city.replace(/[\W_]+/g," ");
            player.latlong = latlong;
            player.visited = timeStamp;
            //console.log(player);
            updateDatabase(player);
          } catch (e) {
            console.log("ERROR: Cannot Get Player Location Info", e);
          }
        } else {
          console.log("ERROR: No IP for player: " + player.guid);
        }
      }
      cleanActivePlayersTable(activePlayers);
    });
  });
  //await snooze(constants.DATA_REFRESH_INTERVAL * 1000);
}

function cleanActivePlayersTable(activePlayers) {
  var query = "DELETE FROM `active_players`";
  // we want to delete any entries in active_players which don't have a guid matching any the current activePlayers
  if (activePlayers.length > 0) {
    query += " WHERE ";
    for (var i = 0; i < activePlayers.length; i++) {
      var p = activePlayers[i];
      query += "guid != '" + p.guid + "'";
      // if there's another player add AND before their guid
      if ((i + 1) < activePlayers.length) {
        query += " AND ";
      }
    }
  }
  db.query(query, (err, result) => {
    if (err) {
      console.log("ERROR: Cannot delete players from active_players table", err);
    } else {
      //console.log("Active player deleted from database");
    }
  });
}

function updateChatlog(messages) {
  for (var i = 0; i < messages.length; i++) {
    var m = messages[i];
    var query = "INSERT INTO `chatlog` (`message`, `guid`, `name`, `occurred`, `in_server`, `type`, `hash`)" +
      "VALUES (" +
      db.escape(m.message) + ", '" +
      m.guid + "', " +
      db.escape(m.name) + ", '" +
      m.occurred + "', '" +
      m.inServer + "', '" +
      m.type + "', '" +
      m.hash + "')" +
      " ON DUPLICATE KEY UPDATE hash=hash";

    db.query(query, (err, result) => {
      if (err) {
        console.log("ERROR: Cannot insert message into chatlog table", err);
      } else {
        //console.log("Message: " + m.hash + " added to database");
      }
    });
  }
}

function updateServerRuns(runs) {
  for (var i = 0; i < runs.length; i++) {
    var r = runs[i];
    var query = "INSERT INTO `server_runs` (`uniq_id`, `guid`, `name`, `zone`, `time`, `occurred`)" +
      "VALUES ('" +
      r.uniqId + "', '" +
      r.guid + "', " +
      db.escape(r.name) + ", '" +
      r.zone + "', '" +
      r.time + "', '" +
      r.occurred + "')" +
      " ON DUPLICATE KEY UPDATE uniq_id=uniq_id";

    db.query(query, (err, result) => {
      if (err) {
        console.log("ERROR: Cannot insert run into server_runs table", err);
      } else {
        //console.log("Message: " + m.hash + " added to database");
      }
    });
  }
}

function updateDatabase(p) {
  //console.log("Player: ", p);
  // update the player record
  var query = "INSERT INTO `players` (`guid`, `name`, `berries`, `gap`, `items`, `challenges`, `runs`, `timeplayed`, `berry`, `vip`, `ip`, `country`, `countrycode`, `city`, `latlong`, `visited`, `easy`, `medium`, `hard`, `slide`, `extreme`, `trial`, `race`)" +
    "VALUES ('" +
    p.guid + "', " +
    db.escape(p.name) + ", '" +
    p.berries + "', '" +
    p.gap + "', '" +
    p.items + "', '" +
    p.challenges + "', '" +
    p.runs + "', '" +
    p.timeplayed + "', '" +
    p.berry + "', '" +
    p.vip + "', '" +
    p.ip + "', '" +
    p.country + "', '" +
    p.countrycode + "', '" +
    p.city + "', '" +
    p.latlong + "', '" +
    p.visited + "', '" +
    p.easy + "', '" +
    p.medium + "', '" +
    p.hard + "', '" +
    p.slide + "', '" +
    p.extreme + "', '" +
    p.trial + "', '" +
    p.race + "')" +
    " ON DUPLICATE KEY UPDATE " +
    "name=VALUES(name), " +
    "berries=VALUES(berries), " +
    "gap=VALUES(gap), " +
    "items=VALUES(items), " +
    "challenges=VALUES(challenges), " +
    "runs=VALUES(runs), " +
    "timeplayed=VALUES(timeplayed), " +
    "berry=VALUES(berry), " +
    "vip=VALUES(vip), " +
    "ip=VALUES(ip), " +
    "country=VALUES(country), " +
    "countrycode=VALUES(countrycode), " +
    "city=VALUES(city), " +
    "latlong=VALUES(latlong), " +
    "visited=VALUES(visited), " +
    "easy=VALUES(easy), " +
    "medium=VALUES(medium), " +
    "hard=VALUES(hard), " +
    "slide=VALUES(slide), " +
    "extreme=VALUES(extreme), " +
    "trial=VALUES(trial), " +
    "race=VALUES(race)";

  db.query(query, (err, result) => {
    if (err) {
      console.log("ERROR: Cannot insert player into players table", err);
    } else {
      console.log("Player: " + p.name + " added to database");
      updateRunsDatabase(p);
    }
  });

  // now add to active players table
  query = "INSERT INTO `active_players` (`guid`, `zone`, `spec`, `afk`, `spec_guid`)" +
    "VALUES ('" +
    p.guid + "', '" +
    p.zone + "', '" +
    p.spec + "', '" +
    p.afk + "', '" +
    p.specGuid + "')" +
    " ON DUPLICATE KEY UPDATE " +
    "zone=VALUES(zone), " +
    "spec=VALUES(spec), " +
    "afk=VALUES(afk), " +
    "spec_guid=VALUES(spec_guid)";

  db.query(query, (err, result) => {
    if (err) {
      console.log("ERROR: Cannot insert player into active_players table", err);
    } else {
      //console.log("Player: " + p.name + " added to active_players database");
    }
  });

  // now add name to aliases table
  query = "INSERT INTO `aliases` (`guid`, `name`)" +
    "VALUES ('" +
    p.guid + "', " +
    db.escape(p.name) + ")" +
    " ON DUPLICATE KEY UPDATE " +
    "guid=VALUES(guid), " +
    "name=VALUES(name)";

  db.query(query, (err, result) => {
    if (err) {
      console.log("ERROR: Cannot insert name into aliases table", err);
    } else {
      //console.log("Player: " + p.name + " added to active_players database");
    }
  });

  checkBerrySnapshot(p);
}

function checkBerrySnapshot(p) {
  // get latest snapshots first
  var query = "SELECT * FROM `berries_snapshot` WHERE guid = '" + p.guid + "' ORDER BY timestamp DESC LIMIT 1";
  db.query(query, (err, result) => {
    if (err) {
      console.log("ERROR: Problem querying database for berry snapshots");
    }
    // no snapshots
    if (result.length <= 0) {
      // add snapshot
      addBerrySnapshot(p);
    }
    else {
      try {
        // get time of last snapshot
        var lastSnapshotTime = Number(result[0].occurred);
        var start = moment(lastSnapshotTime);
        var end = moment();
        var duration = moment.duration(end.diff(start));
        var hours = duration.asHours();
        //console.log(p.name + ": hours since last berry snapshot: " + hours);
        // enough time has passed, take a new snapshot
        if(hours >= constants.BERRY_SNAPSHOT_INTERVAL_HOURS) {
          addBerrySnapshot(p);
        }
      }
      catch(err) {
        console.log("ERROR: Problem parsing times for berry snapshots");
      }
    }
  });
}

function addBerrySnapshot(p) {
  // add berries snapshot to berries_snapshot table
  var query = "INSERT INTO `berries_snapshot` (`guid`, `name`, `berries`, `occurred`)" +
  "VALUES ('" +
  p.guid + "', '" +
  p.name + "', '" +
  p.berries + "', " +
  p.visited + ")";

  db.query(query, (err, result) => {
  if (err) {
    console.log("ERROR: Cannot insert berry snapshot into database", err);
  } else {
    console.log("Berry snapshot for: " + p.name + " added to database");
  }
  });
}

function updateRunsDatabase(p) {
  updateRunsDatabaseByZone(p, "easy");
  updateRunsDatabaseByZone(p, "medium");
  updateRunsDatabaseByZone(p, "hard");
  updateRunsDatabaseByZone(p, "slide");
  updateRunsDatabaseByZone(p, "extreme");
  updateRunsDatabaseByZone(p, "trial");
  updateRunsDatabaseByZone(p, "race");
}

function updateRunsDatabaseByZone(p, zone) {
  var query = "SELECT * FROM `runs` WHERE guid = '" + p.guid + "' AND zone = '" + zone + "' ORDER BY time";
  db.query(query, (err, result) => {
    if (err) {
      console.log("ERROR: Problem querying database for runs");
    }
    if (result.length <= 0) {
      //console.log("No runs found for " + p.name + " in zone: " + zone);
      addRunToDatabase(p.guid, zone, p[zone], p.visited);
    } else {
      //console.log("Runs for " + p.name + " in zone: " + zone, result);
      // if db run is empty or current run is faster than fastest db run (but not 0 i.e. reset), add to db
      var currentFastest = Number(result[0].time);
      if (currentFastest == 0 && Number(p[zone]) > 0) {
        removeEmptyRunFromDatabase(p.guid, zone);
        addRunToDatabase(p.guid, zone, p[zone], p.visited);
      } else if (Number(p[zone]) > 0 && Number(p[zone]) < currentFastest) {
        addRunToDatabase(p.guid, zone, p[zone], p.visited);
      } else {
        //console.log("No need to add run to db");
      }
    }
  });
}

function isInt(value) {
  if (isNaN(value)) {
    return false;
  }
  var x = parseFloat(value);
  return (x | 0) === x;
}

function addRunToDatabase(guid, zone, time, occurred) {
  var query = "INSERT INTO `runs` (`guid`, `zone`, `time`, `occurred`) " +
    "VALUES ('" +
    guid + "', '" +
    zone + "', '" +
    time + "', '" +
    occurred + "')";

  db.query(query, (err, result) => {
    if (err) {
      console.log("ERROR: Cannot insert run into DB", err);
    } else {
      console.log("Run on: " + zone + " added to database");
    }
  });
}

function removeEmptyRunFromDatabase(guid, zone) {
  var query = "DELETE FROM `runs` WHERE guid = '" + guid + "' AND zone = '" + zone + "' AND time = '" + 0 + "'";

  db.query(query, (err, result) => {
    if (err) {
      console.log("ERROR: Cannot delete empty run from DB", err);
    } else {
      console.log("Empty run on: " + zone + " deleted from database");
    }
  });
}