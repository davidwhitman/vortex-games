// @ts-check
const Promise = require('bluebird');
const path = require('path');
const rjson = require('relaxed-json');
const { fs, log, util } = require('vortex-api');
const winapi = require('winapi-bindings');

const GAME_ID = 'starsector';
const MOD_INFO_FILE = "mod_info.json"

// Adapted from https://stackoverflow.com/a/24518413/1622788
// Removes '#'s, which are used as comments by the game's json parser
const COMMENT_STRIPPING_REGEX = /((["'])(?:\\[\s\S]|.)*?\2|\#(?![*\#])(?:\\.|\[(?:\\.|.)\]|.)*?\#)|\#.*?$|\#\*[\s\S]*?\*\#/gm;

/**
 * @returns {string | Promise<String>}
 */
function findGame() {
  try {
    const instPath = winapi.RegGetValue(
      'HKEY_CURRENT_USER',
      'Software\\Fractal Softworks\\Starsector',
      '');
    if (!instPath) {
      throw new Error('Starsector registry key not found!');
    }
    return Promise.resolve(instPath.value);
  } catch (err) {
    return Promise.reject(err);
  }
}

function testSupportedContent(files, gameId) {
  if (gameId !== GAME_ID) {
    return Promise.resolve({ supported: false });
  }

  const contentPath = files.find(file => path.basename(file) === MOD_INFO_FILE);
  return Promise.resolve({
    supported: contentPath !== undefined,
    requiredFiles: [contentPath],
  });
}

async function installContent(files,
  destinationPath,
  gameId,
  progressDelegate) {
  const contentPath = files.find(file => path.basename(file) === MOD_INFO_FILE);
  const basePath = path.dirname(contentPath);

  let outputPath = basePath;

  const contentFile = path.join(destinationPath, contentPath);
  return fs.readFileAsync(contentFile, { encoding: 'utf8' }).then(data => {
    const attrInstructions = [];
    let parsed;
    try {
      // Strip '#' comments using regex, then parse using relaxed-json
      parsed = rjson.parse(data.replace(COMMENT_STRIPPING_REGEX, "$1"));
    } catch (err) {
      log('warn', MOD_INFO_FILE + ' invalid: ' + err.message);
      return Promise.resolve(attrInstructions);
    }

    // Function to get a value from mod_info.json by key
    const getAttr = key => {
      try {
        return parsed[key];
      } catch (err) {
        log('info', 'attribute missing in ' + MOD_INFO_FILE, { key });
        return "";
      }
    }

    // If mod_info.json has no id, this is an invalid mod
    const contentModId = getAttr('id');
    if (contentModId === undefined) {
      return Promise.reject(
        new util.DataInvalid('invalid or unsupported ' + MOD_INFO_FILE));
    }

    outputPath = (contentPath.indexOf(MOD_INFO_FILE) > 0)
      ? path.basename(path.dirname(contentPath))
      : Promise.reject(
        new util.DataInvalid('invalid or unsupported ' + MOD_INFO_FILE));

    // Set the mod name based on mod_info.json
    // TODO If the mod is being installed from Nexus, we don't want to overwrite the name
    attrInstructions.push({
      type: 'attribute',
      key: 'customFileName',
      value: getAttr('name').trim(),
    });

    // Set the mod version based on mod_info.json
    attrInstructions.push({
      type: 'attribute',
      key: 'version',
      value: getAttr('version').trim(),
    });

    // Description is fairly hidden in the UI, and we don't want to overwrite it
    // if it's being set from Nexus Mods.
    // attrInstructions.push({
    //   type: 'attribute',
    //   key: 'description',
    //   value: getAttr('description').trim(),
    // });

    // Set the mod author based on mod_info.json
    attrInstructions.push({
      type: 'attribute',
      key: 'author',
      value: getAttr('author'),
    });


    return Promise.resolve(attrInstructions);
  })
    .then(attrInstructions => {
      let instructions = attrInstructions.concat(files.filter(file =>
        file.startsWith(basePath + path.sep) && !file.endsWith(path.sep))
        .map(file => ({
          type: 'copy',
          source: file,
          destination: path.join(outputPath, file.substring(basePath.length + 1))
        })));
      return { instructions };
    });
}

/**
 * @param {import('vortex-api/lib/types/api').IExtensionContext} context
 */
function main(context) {
  context.registerGame({
    id: GAME_ID,
    name: 'Starsector',
    mergeMods: true,
    queryPath: findGame,
    queryModPath: () => 'mods',
    logo: 'gameart.jpg',
    executable: () => 'starsector.exe',
    requiredFiles: [
      'starsector.exe',
    ]
  });

  context.registerInstaller('starsector', 50, testSupportedContent, installContent);

  return true;
}

module.exports = {
  default: main
};
