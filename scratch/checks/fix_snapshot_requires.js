const fs = require("fs");
const path = require("path");

const SNAPSHOTS_DIR = path.join(__dirname, "..", "..", "scripts", "snapshots");

if (!fs.existsSync(SNAPSHOTS_DIR)) {
  console.error(`Snapshots directory not found: ${SNAPSHOTS_DIR}`);
  process.exit(1);
}

const files = fs.readdirSync(SNAPSHOTS_DIR).filter((f) => f.endsWith(".js"));

console.log(`Scanning ${files.length} snapshot test files...`);

files.forEach((file) => {
  const filePath = path.join(SNAPSHOTS_DIR, file);
  let content = fs.readFileSync(filePath, "utf8");
  
  let modified = false;
  
  // Replace require("../src/ with require("../../src/
  if (content.includes('require("../src/')) {
    content = content.replace(/require\("\.\.\/src\//g, 'require("../../src/');
    modified = true;
  }
  if (content.includes("require('../src/")) {
    content = content.replace(/require\('\.\.\/src\//g, "require('../../src/");
    modified = true;
  }
  
  // Replace path.join(__dirname, "..", "src" with path.join(__dirname, "..", "..", "src"
  if (content.includes('path.join(__dirname, "..", "src"')) {
    content = content.replace(/path\.join\(__dirname,\s*"\.\.",\s*"src"/g, 'path.join(__dirname, "..", "..", "src"');
    modified = true;
  }
  if (content.includes("path.join(__dirname, '..', 'src'")) {
    content = content.replace(/path\.join\(__dirname,\s*'\.\.',\s*'src'/g, "path.join(__dirname, '..', '..', 'src'");
    modified = true;
  }

  // Replace path.join(__dirname, "..", "config" with path.join(__dirname, "..", "..", "config"
  if (content.includes('path.join(__dirname, "..", "config"')) {
    content = content.replace(/path\.join\(__dirname,\s*"\.\.",\s*"config"/g, 'path.join(__dirname, "..", "..", "config"');
    modified = true;
  }
  if (content.includes("path.join(__dirname, '..', 'config'")) {
    content = content.replace(/path\.join\(__dirname,\s*'\.\.',\s*'config'/g, "path.join(__dirname, '..', '..', 'config'");
    modified = true;
  }

  // General path.join(__dirname, "..", ...) checks that might target root directory assets
  // e.g. path.join(__dirname, "..", "package.json")
  if (content.includes('path.join(__dirname, "..", "package.json"')) {
    content = content.replace(/path\.join\(__dirname,\s*"\.\.",\s*"package\.json"/g, 'path.join(__dirname, "..", "..", "package.json"');
    modified = true;
  }
  
  // General check for require("../config"
  if (content.includes('require("../config/')) {
    content = content.replace(/require\("\.\.\/config\//g, 'require("../../config/');
    modified = true;
  }
  if (content.includes("require('../config/")) {
    content = content.replace(/require\('\.\.\/config\//g, "require('../../config/");
    modified = true;
  }
  
  if (modified) {
    fs.writeFileSync(filePath, content, "utf8");
    console.log(`- Fixed imports in: ${file}`);
  }
});

console.log("Require paths adjustments completed.");
