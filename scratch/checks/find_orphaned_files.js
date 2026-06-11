const fs = require("fs");
const path = require("path");

const SRC_DIR = path.join(__dirname, "..", "..", "src");

// Helper to recursively list files
function getFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      if (!file.includes("scratch") && !file.includes("obsoletos")) {
        results = results.concat(getFiles(filePath));
      }
    } else if (file.endsWith(".js")) {
      results.push(filePath);
    }
  });
  return results;
}

const allFiles = getFiles(SRC_DIR);

// Read content of all files to search for references
const fileContents = {};
allFiles.forEach((file) => {
  fileContents[file] = fs.readFileSync(file, "utf8");
});

// Also read index.js references
const mainFile = path.join(SRC_DIR, "index.js");

console.log(`Found ${allFiles.length} JavaScript files in src/. Analyzing references...`);

const orphaned = [];
const activeReferences = {};

allFiles.forEach((file) => {
  const relativeFromSrc = path.relative(SRC_DIR, file);
  const baseName = path.basename(file, ".js");
  
  if (file === mainFile) {
    activeReferences[file] = ["(Entry point)"];
    return;
  }
  
  const refs = [];
  
  Object.keys(fileContents).forEach((otherFile) => {
    if (otherFile === file) return;
    
    const content = fileContents[otherFile];
    
    // Check if the other file contains a require pattern for this file name.
    // E.g., require("./fletes") or require("../fletes") or require("./services/fletes")
    // We look for the base name or parts of the path in the require strings.
    const escapedBase = baseName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const requireRegex = new RegExp(`require\\s*\\(\\s*['"\`].*${escapedBase}['"\`]\\s*\\)`, "g");
    
    if (requireRegex.test(content)) {
      refs.push(path.relative(SRC_DIR, otherFile));
    }
  });
  
  if (refs.length > 0) {
    activeReferences[file] = refs;
  } else {
    orphaned.push(file);
  }
});

console.log("\n=== ORPHANED FILES (No require references in active src/ files) ===");
if (orphaned.length === 0) {
  console.log("No orphaned files found!");
} else {
  orphaned.forEach((file) => {
    console.log(`- src/${path.relative(SRC_DIR, file)}`);
  });
}

console.log("\n=== ACTIVE FILE REFERENCES ===");
Object.keys(activeReferences).forEach((file) => {
  console.log(`src/${path.relative(SRC_DIR, file)} referenced by:`);
  activeReferences[file].forEach((ref) => {
    console.log(`  -> ${ref}`);
  });
});
