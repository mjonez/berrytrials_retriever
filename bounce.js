var fs = require('fs');
var bouncy = require('bouncy');
console.log("Bouncy server listening on port 80");
bouncy(function(req, res, bounce){
 if(req.headers.host === 'berry.watch') {
 	bounce(4200);
 }
}).listen(80);