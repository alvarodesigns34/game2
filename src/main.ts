// Fuentes servidas desde el propio bundle: el juego tiene que arrancar igual
// sin conexion, y sin depender de que un tercero siga sirviendolas.
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './ui/style.css';
import { Game } from './game';
import { Tool } from './sim/world';
import { mountHud } from './ui/hud';
import { installDebugApi } from './ui/debug';
import { installInput } from './ui/input';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const hudRoot = document.getElementById('hud') as HTMLDivElement;

const game = new Game(canvas);
mountHud(hudRoot, game);
installInput(canvas, game);
installDebugApi(game);

game.setTool(Tool.Road);
game.start();

window.addEventListener('resize', () => game.resize());
