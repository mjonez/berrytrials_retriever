const fs = require('fs');
const Path = require('path');
const axios = require('axios');
const constants = require('./constants');
const config = require('./config');
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

async function downloadGamesMp() {
	const url = 'http://berrytrials.me:4180/cod4/mods/berry_promod/games_mp.log';
	const path = Path.resolve(__dirname, 'logs', 'games_mp.log');
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

async function downloadServerLog() {
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
	host: config.MYSQL_H,
	user: config.MYSQL_U,
	password: config.MYSQL_P,
	database: config.MYSQL_D,
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
	await downloadGamesMp();
	await downloadServerLog();
	console.log("Finished downloading log files");
}

function readInfo() {
	var guidIp = {};
	var guidBuid = {};

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

	// Finished reading enterleave.log so we have collected ip addresses, now read server_log.txt
	lr.on('end', function () {
		// now read server_log.txt
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

			// player json saving mode and json object detected
			if (playerInfoJson && line.startsWith("{'buid': '")) {
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
					// add to guid buid map, so we can check vs chatlog
					guidBuid[playerObj.guid] = playerObj.buid;
					activePlayers.push(playerObj);
				} catch (e) {
					console.log("ERROR: Cannot Parse Player JSON", jsonLine);
					// add players from old active players to new active players
					for (var i = 0; i < oldActivePlayers.length; i++) {
						var activeBuid = oldActivePlayers[i].buid;
						var isAlreadyAdded = false;
						for (var j = 0; j < activePlayers.length; j++) {
							if (activePlayers[j].buid == activeBuid) {
								isAlreadyAdded = true;
								break;
							}
						}
						if (!isAlreadyAdded) {
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
						player.city = city.replace(/[\W_]+/g, " ");
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

			// Finished reading server_log.txt, now read games_mp.log
			//console.log("Finished reading server_log.txt" + "\n");
			console.log("Reading games_mp.log");
			playerInfoJson = false;
			runInfoJson = false;
			messages = [];
			lr = new LineByLineReader(constants.GAMES_MP_PATH);
			lineCount = 0;
			line2 = "";
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
						var inServerBuids = "";
						for (var i = 0; i < activePlayers.length; i++) {
							inServerBuids += activePlayers[i].buid + " ";
						}
						inServerBuids = inServerBuids.trim();
						var hash = useful.md5HashString(line + line2);
						// create message object
						var messageObj = {};
						messageObj.message = message;
						messageObj.buid = guidBuid[guid];
						messageObj.guid = guid;
						messageObj.name = name;
						messageObj.occurred = timeStamp;
						messageObj.type = msgType;
						messageObj.inServer = inServerBuids;
						messageObj.hash = hash;
						messages.push(messageObj);
						//console.log("messageObj", messageObj)
					} catch (e) {
						console.log("ERROR: Cannot Parse Message", line);
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
			// finished reading games_mp.log
			lr.on('end', function () {
				//console.log("Finished reading games_mp.log");

				// add messages to chatlog
				updateChatlog(messages);

				// add runs
				updateServerRuns(runs);
			});
		});
	});
}

function cleanActivePlayersTable(activePlayers) {
	var query = "DELETE FROM `active_players`";
	// we want to delete any entries in active_players which don't have a guid matching any the current activePlayers
	if (activePlayers.length > 0) {
		query += " WHERE ";
		for (var i = 0; i < activePlayers.length; i++) {
			var p = activePlayers[i];
			query += "buid != '" + p.buid + "'";
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
		var query = "INSERT INTO `chatlog` (`message`, `buid`, `guid`, `name`, `occurred`, `in_server`, `type`, `hash`)" +
			"VALUES (" +
			db.escape(m.message) + ", '" +
			m.buid + "', '" +
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
		var query = "INSERT INTO `server_runs` (`uniq_id`, `buid`, `name`, `zone`, `time`, `occurred`)" +
			"VALUES ('" +
			r.uniqId + "', '" +
			r.buid + "', " +
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
	var query = "INSERT INTO `players` (`buid`, `guid`, `name`, `berries`, `motto`, `gap`, `gap_epoch`, `items`, `challenges`, `runs`, `timeplayed`, `epochtime`, `berry`, `vip`, `ip`, `country`, `countrycode`, `city`, `latlong`, `visited`, `easy`, `medium`, `hard`, `insane`, `extreme`, `trial`, `race`, `therun`, `easy_saves_loads`, `easy_epoch`, `easy_splits`, `medium_saves_loads`, `medium_epoch`, `medium_splits`, `hard_saves_loads`, `hard_epoch`, `hard_splits`, `extreme_saves_loads`, `extreme_epoch`, `extreme_splits`, `insane_saves_loads`, `insane_epoch`, `insane_splits`, `trial_epoch`, `trial_splits`, `race_epoch`, `race_splits`, `therun_epoch`, `therun_splits`, `pieces`, `pk_games`, `pk_wins`, `hill_games`, `hill_wins`, `hill_killstreak`, `hill_killstreak_epoch`, `berry_casino`, `berry_wta_race`, `berry_wta_hill`, `berry_gifted`, `berry_received`, `berry_pk`)" +
		"VALUES ('" +
		p.buid + "', '" +
		p.guid + "', " +
		db.escape(p.name) + ", '" +
		p.berries + "', " +
		db.escape(p.motto) + ", '" +
		p.gap + "', '" +
		p.gap_epoch + "', '" +
		p.items + "', '" +
		p.challenges + "', '" +
		p.runs + "', '" +
		p.timeplayed + "', '" +
		p.epochtime + "', '" +
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
		p.insane + "', '" +
		p.extreme + "', '" +
		p.trial + "', '" +
		p.race + "', '" +
		p.therun + "', '" +
		p.easy_saves_loads + "', '" +
		p.easy_epoch + "', '" +
		p.easy_splits + "', '" +
		p.medium_saves_loads + "', '" +
		p.medium_epoch + "', '" +
		p.medium_splits + "', '" +
		p.hard_saves_loads + "', '" +
		p.hard_epoch + "', '" +
		p.hard_splits + "', '" +
		p.extreme_saves_loads + "', '" +
		p.extreme_epoch + "', '" +
		p.extreme_splits + "', '" +
		p.insane_saves_loads + "', '" +
		p.insane_epoch + "', '" +
		p.insane_splits + "', '" +
		p.trial_epoch + "', '" +
		p.trial_splits + "', '" +
		p.race_epoch + "', '" +
		p.race_splits + "', '" +
		p.therun_epoch + "', '" +
		p.therun_splits + "', '" +
		p.pieces + "', '" +
		p.pk_games + "', '" +
		p.pk_wins + "', '" +
		p.hill_games + "', '" +
		p.hill_wins + "', '" +
		p.hill_killstreak + "', '" +
		p.hill_killstreak_epoch + "', '" +
		p.berry_casino + "', '" +
		p.berry_wta_race + "', '" +
		p.berry_wta_hill + "', '" +
		p.berry_gifted + "', '" +
		p.berry_received + "', '" +
		p.berry_pk + "')" +
		" ON DUPLICATE KEY UPDATE " +
		"guid=VALUES(guid), " +
		"name=VALUES(name), " +
		"berries=VALUES(berries), " +
		"motto=VALUES(motto), " +
		"gap=VALUES(gap), " +
		"gap_epoch=VALUES(gap_epoch), " +
		"items=VALUES(items), " +
		"challenges=VALUES(challenges), " +
		"runs=VALUES(runs), " +
		"timeplayed=VALUES(timeplayed), " +
		"epochtime=VALUES(epochtime), " +
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
		"insane=VALUES(insane), " +
		"extreme=VALUES(extreme), " +
		"trial=VALUES(trial), " +
		"race=VALUES(race), " +
		"therun=VALUES(therun), " +
		"easy_saves_loads=VALUES(easy_saves_loads), " +
		"easy_epoch=VALUES(easy_epoch), " +
		"easy_splits=VALUES(easy_splits), " +
		"medium_saves_loads=VALUES(medium_saves_loads), " +
		"medium_epoch=VALUES(medium_epoch), " +
		"medium_splits=VALUES(medium_splits), " +
		"hard_saves_loads=VALUES(hard_saves_loads), " +
		"hard_epoch=VALUES(hard_epoch), " +
		"hard_splits=VALUES(hard_splits), " +
		"extreme_saves_loads=VALUES(extreme_saves_loads), " +
		"extreme_epoch=VALUES(extreme_epoch), " +
		"extreme_splits=VALUES(extreme_splits), " +
		"insane_saves_loads=VALUES(insane_saves_loads), " +
		"insane_epoch=VALUES(insane_epoch), " +
		"insane_splits=VALUES(insane_splits), " +
		"trial_epoch=VALUES(trial_epoch), " +
		"trial_splits=VALUES(trial_splits), " +
		"race_epoch=VALUES(race_epoch), " +
		"race_splits=VALUES(race_splits), " +
		"therun_epoch=VALUES(therun_epoch), " +
		"therun_splits=VALUES(therun_splits), " +
		"pk_games=VALUES(pk_games), " +
		"pk_wins=VALUES(pk_wins), " +
		"hill_games=VALUES(hill_games), " +
		"hill_wins=VALUES(hill_wins), " +
		"hill_killstreak=VALUES(hill_killstreak), " +
		"hill_killstreak_epoch=VALUES(hill_killstreak_epoch), " +
		"berry_casino=VALUES(berry_casino), " +
		"berry_wta_race=VALUES(berry_wta_race), " +
		"berry_wta_hill=VALUES(berry_wta_hill), " +
		"berry_gifted=VALUES(berry_gifted), " +
		"berry_received=VALUES(berry_received), " +
		"berry_pk=VALUES(berry_pk)";

	db.query(query, (err, result) => {
		if (err) {
			console.log("ERROR: Cannot insert player into players table", err);
		} else {
			console.log("Player: " + p.name + " added to database");
			updateRunsDatabase(p);
		}
	});

	// now add to active players table
	query = "INSERT INTO `active_players` (`buid`, `zone`, `spec`, `afk`, `spec_buid`)" +
		"VALUES ('" +
		p.buid + "', '" +
		p.zone + "', '" +
		p.spec + "', '" +
		p.afk + "', '" +
		p.specBuid + "')" +
		" ON DUPLICATE KEY UPDATE " +
		"zone=VALUES(zone), " +
		"spec=VALUES(spec), " +
		"afk=VALUES(afk), " +
		"spec_buid=VALUES(spec_buid)";

	db.query(query, (err, result) => {
		if (err) {
			console.log("ERROR: Cannot insert player into active_players table", err);
		} else {
			//console.log("Player: " + p.name + " added to active_players database");
		}
	});

	// now add name to aliases table
	query = "INSERT INTO `aliases` (`buid`, `name`)" +
		"VALUES ('" +
		p.buid + "', " +
		db.escape(p.name) + ")" +
		" ON DUPLICATE KEY UPDATE " +
		"buid=VALUES(buid), " +
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
	var query = "SELECT * FROM `berries_snapshot` WHERE buid = '" + p.buid + "' ORDER BY timestamp DESC LIMIT 1";
	db.query(query, (err, result) => {
		if (err) {
			console.log("ERROR: Problem querying database for berry snapshots");
		}
		// no snapshots
		if (result.length <= 0) {
			// add snapshot
			addBerrySnapshot(p);
		} else {
			try {
				// get time of last snapshot
				var lastSnapshotTime = Number(result[0].occurred);
				var start = moment(lastSnapshotTime);
				var end = moment();
				var duration = moment.duration(end.diff(start));
				var hours = duration.asHours();
				//console.log(p.name + ": hours since last berry snapshot: " + hours);
				// enough time has passed, take a new snapshot
				if (hours >= constants.BERRY_SNAPSHOT_INTERVAL_HOURS) {
					addBerrySnapshot(p);
				}
			} catch (err) {
				console.log("ERROR: Problem parsing times for berry snapshots");
			}
		}
	});
}

function addBerrySnapshot(p) {
	// add berries snapshot to berries_snapshot table
	var query = "INSERT INTO `berries_snapshot` (`buid`, `name`, `berries`, `occurred`)" +
		"VALUES ('" +
		p.buid + "', '" +
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
	updateRunsDatabaseByZone(p, "extreme");
	updateRunsDatabaseByZone(p, "insane");
	updateRunsDatabaseByZone(p, "trial");
	updateRunsDatabaseByZone(p, "race");
	updateRunsDatabaseByZone(p, "therun");
}

function updateRunsDatabaseByZone(p, zone) {
	var query = "SELECT * FROM `runs` WHERE buid = '" + p.buid + "' AND zone = '" + zone + "' ORDER BY time";
	db.query(query, (err, result) => {
		if (err) {
			console.log("ERROR: Problem querying database for runs");
		}
		if (result.length <= 0) {
			//console.log("No runs found for " + p.name + " in zone: " + zone);
			addRunToDatabase(p.buid, zone, p[zone], p.visited);
		} else {
			//console.log("Runs for " + p.name + " in zone: " + zone, result);
			// if db run is empty or current run is faster than fastest db run (but not 0 i.e. reset), add to db
			var currentFastest = Number(result[0].time);
			if (currentFastest == 0 && Number(p[zone]) > 0) {
				removeEmptyRunFromDatabase(p.buid, zone);
				addRunToDatabase(p.buid, zone, p[zone], p.visited);
			} else if (Number(p[zone]) > 0 && Number(p[zone]) < currentFastest) {
				addRunToDatabase(p.buid, zone, p[zone], p.visited);
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

function addRunToDatabase(buid, zone, time, occurred) {
	var query = "INSERT INTO `runs` (`buid`, `zone`, `time`, `occurred`) " +
		"VALUES ('" +
		buid + "', '" +
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

function removeEmptyRunFromDatabase(buid, zone) {
	var query = "DELETE FROM `runs` WHERE buid = '" + buid + "' AND zone = '" + zone + "' AND time = '" + 0 + "'";

	db.query(query, (err, result) => {
		if (err) {
			console.log("ERROR: Cannot delete empty run from DB", err);
		} else {
			console.log("Empty run on: " + zone + " deleted from database");
		}
	});
}