// A rudimentary check of the CSS sizes and variables just to be paranoid
const fs = require('fs');
const css = fs.readFileSync('src/components/SyllabusSidebar.module.css', 'utf8');
if (!css.includes('.sidebar')) console.log("Missing sidebar");
if (!css.includes('.active')) console.log("Missing active");
console.log("CSS length:", css.length);
