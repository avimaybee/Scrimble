import fs from 'fs';

let code = fs.readFileSync('src/pages/ProjectCanvas.tsx', 'utf8');

code = code.replace(/const nodeTypes = \{[\s\S]*?\};\n\n/m, '');

const startIdx = code.indexOf('  useEffect(() => {\n    if (appSteps.length === 0) return;\n\n    const flowNodes');
if (startIdx > -1) {
  const endStr = '  }, []);\n\n  const handleStepComplete';
  const endIdx = code.indexOf(endStr, startIdx);
  if (endIdx > -1) {
    code = code.substring(0, startIdx) + '  const handleStepComplete' + code.substring(endIdx + endStr.length);
  }
}

fs.writeFileSync('src/pages/ProjectCanvas.tsx', code);
console.log("cleaned");