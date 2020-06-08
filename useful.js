exports.isInt = function (value) {
    if (isNaN(value)) {
        return false;
    }
    var x = parseFloat(value);
    return (x | 0) === x;
}

exports.md5HashString = function(toHash) {
    return require('crypto').createHash('md5').update(toHash).digest("hex");
}

exports.alphanumeric = function (str) {
    var code, i, len;
  
    for (i = 0, len = str.length; i < len; i++) {
      code = str.charCodeAt(i);
      if (!(code > 47 && code < 58) && // numeric (0-9)
          !(code > 64 && code < 91) && // upper alpha (A-Z)
          !(code > 96 && code < 123)) { // lower alpha (a-z)
        return false;
      }
    }
    return true;
}


exports.escapeHtml = function (unsafe) {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
 }

exports.processStatTime = function (time) {

    time = parseInt(time) / 1000;
    var timeStr = "" + time;
    // second times
    if (time <= 60) {
        // no decimal
        // 17
        if (!timeStr.includes('.')) {
            timeStr += ".00";
        } else {
            var split = timeStr.split(".");
            var beforeDec = split[0];
            var afterDec = split[1];
            //17.
            if (afterDec.length == 0) {
                afterDec = "00";
            }
            //17.3
            else if (afterDec.length == 1) {
                afterDec += "0";
            }
            //17.30
            else if (afterDec.length == 2) {
                // fine
            }
            //17.333333
            else {
                afterDec = afterDec.substring(0, 2);
            }
            timeStr = beforeDec + "." + afterDec;
        }
    }
    // minute times
    if (time > 60) {
        var minutes = Math.floor(time / 60);
        var seconds = (time % 60).toFixed(2);
        var secStr = "" + seconds;
        // no decimal
        // 17
        if (!secStr.includes('.')) {
            // 7
            if (secStr.length == 1) {
                secStr = "0" + secStr;
            }
            secStr += ".00";
        } else {
            var split = secStr.split(".");
            var beforeDec = split[0];
            var afterDec = split[1];

            // 7
            if (beforeDec.length == 1) {
                beforeDec = "0" + beforeDec;
            }

            //17.
            if (afterDec.length == 0) {
                afterDec = "00";
            }
            //17.3
            else if (afterDec.length == 1) {
                afterDec += "0";
            }
            //17.30
            else if (afterDec.length == 2) {
                // fine
            }
            //17.333333
            else {
                afterDec = afterDec.substring(0, 2);
            }
            secStr = beforeDec + "." + afterDec;
        }
        timeStr = minutes + ":" + secStr;
    }
    return timeStr;
}