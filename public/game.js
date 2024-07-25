let board;
let player = {};
let currentPlayerNumber;
let waitingForOpponent = true;
let lastFlippedTile = null;
let flipDuration = 500; // Duration of the flip animation in milliseconds
let playerNumberEnum = {};
let themes = {};
const socket = io();

// Fetch CSS variables
const rootStyles = getComputedStyle(document.documentElement);
let player1Color = rootStyles.getPropertyValue('--player1-color').trim();
let player2Color = rootStyles.getPropertyValue('--player2-color').trim();
document.styleSheets[0].insertRule(`.flipped { animation: flip ${flipDuration}ms ease-in-out; }`, 0); // Update flip duration dynamically

// DOM elements
const landingPage = document.getElementById('landing');
const gamePage = document.getElementById('game');
const playerNameInput = document.getElementById('playerName');
const joinButton = document.getElementById('joinButton');
const turnIndicator = document.getElementById('turnIndicator');
const playerList = document.getElementById('playerList');
const themeSelect = document.getElementById('themeSelect');

const directions = [
    {dx: 0, dy: 0}, // Center
    {dx: 0, dy: -1}, // Up
    {dx: 0, dy: 1},  // Down
    {dx: -1, dy: 0}, // Left
    {dx: 1, dy: 0}   // Right
];

socket.on('playerDisconnected', (data) => {
    board = data.board;
    players = data.players;
    currentPlayerNumber = data.currentPlayerNumber;
    waitingForOpponent = data.waitingForOpponent;
    lastFlippedTile = null; // to remove lock icon on game reset
    document.getElementById('opponentColor').style.backgroundColor = 'black';

    updateScores(data.players);
    renderBoard();
    updateTurnIndicator();
});

socket.on('receiveThemesAndEnums', (data) => {
    themes = data.themes;
    playerNumberEnum = data.playerNumberEnum;

    Object.keys(themes).forEach(theme => {
        const option = document.createElement('option');
        option.value = theme;
        option.textContent = theme;
        themeSelect.appendChild(option);
    });
});

joinButton.addEventListener('click', () => {
    const playerName = playerNameInput.value.trim();
    if (playerName) {
        socket.emit('join', {name: playerName});
        landingPage.style.display = 'none';
        gamePage.style.display = 'block';
    }
});

themeSelect.addEventListener('change', (event) => {
    const selectedTheme = event.target.value;
    socket.emit('requestThemeChange', { playerNumber: player.playerNumber, theme: selectedTheme });
});

function applyTheme(players) {
    const selectedThemeName = Object.values(players).find(p => p.playerNumber === player.playerNumber).theme;
    const selectedTheme = themes[selectedThemeName];

    player1Color = selectedTheme.player1Color;
    player2Color = selectedTheme.player2Color;
    document.documentElement.style.setProperty('--player1-color', selectedTheme.player1Color);
    document.documentElement.style.setProperty('--player2-color', selectedTheme.player2Color);
    document.documentElement.style.setProperty('--background-color', selectedTheme.backgroundColor);
    document.documentElement.style.setProperty('--board-color', selectedTheme.boardColor);
    document.documentElement.style.setProperty('--board-border-color', selectedTheme.boardBorderColor);
    document.documentElement.style.setProperty('--tile-border-color', selectedTheme.tileBorderColor);
    document.documentElement.style.setProperty('--territory-border-color', selectedTheme.territoryBorderColor);
    document.documentElement.style.setProperty('--text-color', selectedTheme.textColor);

    // update youColor and opponentColor
    document.getElementById('youColor').style.backgroundColor = player.playerNumber === 1 ? selectedTheme.player1Color : selectedTheme.player2Color;
    document.getElementById('opponentColor').style.backgroundColor = player.playerNumber === 1 ? selectedTheme.player2Color : selectedTheme.player1Color;

    renderBoard();
}

socket.on('themeChange', (data) => {
    const { playerNumber, players } = data;
    if (playerNumber !== player.playerNumber) {return;}

    applyTheme(players);
});

socket.on('initializeBoard', (data) => {
    board = data.board;
    currentPlayerNumber = data.currentPlayerNumber;
    const players = data.players;
    renderBoard();
    updateScores(players);
});

socket.on('assignPlayer', (data) => {
    player = data.player;
    waitingForOpponent = data.waitingForOpponent;
    updateTurnIndicator();
});

function addTileHoverListeners(tileElement, x, y) {
    tileElement.addEventListener('mouseenter', () => handleTileHover(x, y));
    tileElement.addEventListener('mouseleave', () => handleTileHoverOut(x, y));
}

function handleTileHover(x, y) {
    if (!waitingForOpponent && player.playerNumber === currentPlayerNumber && board[x][y] !== player.playerNumber) {
        if (lastFlippedTile && lastFlippedTile.x === x && lastFlippedTile.y === y) {
            return; // Skip hover effect
        }

        const hoverClass = player.playerNumber === 1 ? 'tile-selector-player1' : 'tile-selector-player2';

        directions.forEach(dir => {
            const newX = x + dir.dx;
            const newY = y + dir.dy;
            if (isValidTile(newX, newY) && board[newX][newY] !== player.playerNumber) {
                const tileElement = document.querySelector(`.tile[data-x='${newX}'][data-y='${newY}']`);
                if (tileElement) {
                    tileElement.classList.add(hoverClass);
                }
            }
        });
    }
}

function handleTileHoverOut(x, y) {
    if (!waitingForOpponent && player.playerNumber === currentPlayerNumber && board[x][y] !== player.playerNumber) {

        const hoverClass = player.playerNumber === 1 ? 'tile-selector-player1' : 'tile-selector-player2';

        directions.forEach(dir => {
            const newX = x + dir.dx;
            const newY = y + dir.dy;
            if (isValidTile(newX, newY)) {
                const tileElement = document.querySelector(`.tile[data-x='${newX}'][data-y='${newY}']`);
                if (tileElement) {
                    tileElement.classList.remove(hoverClass);
                }
            }
        });
    }
}


function isValidTile(x, y) {
    return x >= 0 && x < board.length && y >= 0 && y < board[0].length;
}

// Function to render the board
function renderBoard() {
    const boardElement = document.getElementById('board');
    boardElement.innerHTML = ''; // Clear existing board

    // Render tiles
    board.forEach((row, x) => {
        row.forEach((tileOwner, y) => {
            const tileElement = document.createElement('div');
            tileElement.className = 'tile';
            tileElement.style.backgroundColor = tileOwner === 1 ? player1Color : player2Color;
            tileElement.dataset.x = x;
            tileElement.dataset.y = y;
            tileElement.addEventListener('click', () => handleTileClick(x, y));

            // Add lock icon if this tile is locked
            if (lastFlippedTile && lastFlippedTile.x === x && lastFlippedTile.y === y) {
                const lockIcon = document.createElement('span');
                lockIcon.className = 'lock-icon';
                lockIcon.textContent = '🔒';
                tileElement.appendChild(lockIcon);
            }

            tileElement.addEventListener('mouseenter', () => handleTileHover(x, y));
            tileElement.addEventListener('mouseleave', () => handleTileHoverOut(x, y));

            boardElement.appendChild(tileElement);
        });
    });

    // Render territory borders
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
            const territoryBorder = document.createElement('div');
            territoryBorder.className = 'territory-border';
            territoryBorder.style.left = `${i * 155}px`; // Adjusted for border and gap
            territoryBorder.style.top = `${j * 155}px`; // Adjusted for border and gap
            boardElement.appendChild(territoryBorder);
        }
    }
}

function handleTileClick(x, y) {
    if (!waitingForOpponent && player.playerNumber === currentPlayerNumber && board[x][y] !== player.playerNumber) {
        // Prevent flipping the last flipped tile
        if (lastFlippedTile && lastFlippedTile.x === x && lastFlippedTile.y === y) {
            return;
        }

        const hoverClass = player.playerNumber === 1 ? 'tile-selector-player1' : 'tile-selector-player2';

        // Remove hover effect from all tiles
        const allTiles = document.querySelectorAll(`.${hoverClass}`);
        allTiles.forEach(tile => tile.classList.remove(hoverClass));

        socket.emit('move', {player, x, y}); // Emit player identifier
    }
}

async function flipTile(x, y, playerNumber) {
    return new Promise((resolve) => {
        const tileElement = document.querySelector(`.tile[data-x='${x}'][data-y='${y}']`);
        console.log('tileElement', tileElement);
        console.log('board[x][y]', board[x][y]);
        if (tileElement) {
            tileElement.classList.add('flipped');
            setTimeout(() => {
                tileElement.style.backgroundColor = playerNumber === 1 ? player1Color : player2Color;
            }, (flipDuration * 0.5)); // Change color at the halfway point of the animation
            setTimeout(() => {
                tileElement.classList.remove('flipped');
                resolve();
            }, flipDuration);
        } else {
            resolve();
        }
    });
}

async function flipTileGroup(tiles, playerNumber) {
    const flipPromises = tiles.map(({x, y}) => flipTile(x, y, playerNumber));
    await Promise.all(flipPromises);
}

socket.on('updateGame', async (data) => {
    board = data.board;
    const captureGroups = data.captureGroups || [];
    currentPlayerNumber = data.currentPlayerNumber;
    lastFlippedTile = data.lastFlippedTile;
    players = data.players;
    waitingForOpponent = data.waitingForOpponent;

    updateScores(players);

    // Update player color indicators
    document.getElementById('youColor').style.backgroundColor = player.playerNumber === 1 ? player1Color : player2Color;
    document.getElementById('opponentColor').style.backgroundColor = player.playerNumber === 1 ? player2Color : player1Color;

    // Sequentially animate captureGroups
    for (const group of captureGroups) {
        await flipTileGroup(group, player.playerNumber);
    }

    // Add lock icon to selected tile
    const tileElement = document.querySelector(`.tile[data-x='${lastFlippedTile?.x}'][data-y='${lastFlippedTile?.y}']`);
    if (tileElement) {
        const lockIcon = document.createElement('span');
        lockIcon.className = 'lock-icon';
        lockIcon.textContent = '🔒';
        tileElement.appendChild(lockIcon);
    }

    renderBoard();
    updateTurnIndicator();
});

function updateTurnIndicator() {
    if (waitingForOpponent) {
        turnIndicator.textContent = "Waiting for an opponent to join...";
    } else if (player.playerNumber === currentPlayerNumber) {
        turnIndicator.textContent = "It's your turn!";
    } else {
        turnIndicator.textContent = "Waiting for opponent's turn...";
    }
}

function updateScores(players) {
    const you = Object.values(players).find(p => p.id === socket.id);
    const opponent = Object.values(players).find(p => p.id !== socket.id);

    if (you) {
        document.getElementById('youScore').textContent = `${player.name}: ${you.score || 0}`;
    }

    if (opponent) {
        document.getElementById('opponentScore').textContent = `Opponent: ${opponent.score || 0}`;
    } else {
        document.getElementById('opponentScore').textContent = `Opponent: 0`; // Reset opponent score if no opponent
    }
}
