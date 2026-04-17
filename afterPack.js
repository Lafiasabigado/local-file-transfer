const fs = require('fs');
const path = require('path');

// Ce hook est appelé par electron-builder APRÈS l'empaquetage, mais AVANT la création du .AppImage
// Il remplace le binaire principal par un wrapper shell qui injecte --no-sandbox automatiquement
exports.default = async function(context) {
    // On ne touche qu'à Linux (Windows et Mac n'ont pas ce problème)
    if (context.electronPlatformName !== 'linux') return;

    const appOutDir = context.appOutDir;
    const executableName = context.packager.executableName;
    const electronBinaryPath = path.join(appOutDir, executableName);

    // 1. Renommer le vrai binaire Electron
    const realBinaryPath = electronBinaryPath + '-bin';
    fs.renameSync(electronBinaryPath, realBinaryPath);

    // 2. Créer un wrapper shell qui lance le vrai binaire avec --no-sandbox
    const wrapperContent = `#!/bin/bash
HERE="$(dirname "$(readlink -f "$0")")"
exec "$HERE/${executableName}-bin" --no-sandbox "$@"
`;

    fs.writeFileSync(electronBinaryPath, wrapperContent, { mode: 0o755 });
    console.log(`✅ Linux sandbox wrapper created for: ${executableName}`);
};
