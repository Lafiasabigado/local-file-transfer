const fs = require('fs');
const path = require('path');

// Hook appelé par electron-builder APRÈS l'empaquetage
// Injecte --no-sandbox dans le binaire Linux via un wrapper shell
exports.default = async function(context) {
    if (context.electronPlatformName !== 'linux') return;

    const appOutDir = context.appOutDir;
    // Le nom du produit en minuscule avec tirets, tel que généré par electron-builder
    const executableName = context.packager.executableName;
    const electronBinaryPath = path.join(appOutDir, executableName);

    if (!fs.existsSync(electronBinaryPath)) {
        console.warn(`⚠️  afterPack: binary not found at ${electronBinaryPath}, skipping wrapper`);
        return;
    }

    // 1. Renommer le vrai binaire
    const realBinaryPath = electronBinaryPath + '-bin';
    fs.renameSync(electronBinaryPath, realBinaryPath);

    // 2. Créer le wrapper shell
    const wrapperContent = `#!/bin/bash
HERE="$(dirname "$(readlink -f "$0")")"
exec "$HERE/${executableName}-bin" --no-sandbox "$@"
`;
    fs.writeFileSync(electronBinaryPath, wrapperContent, { mode: 0o755 });
    console.log(`✅ Linux no-sandbox wrapper created: ${executableName}`);
};
