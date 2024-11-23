const socket = io();
let board;
let player = {};
let currentPlayerNumber;
let waitingForOpponent = true;
let lastFlippedTile = null;
let currentHoverX = null;
let currentHoverY = null;
let flipDuration = 500; // Duration of the flip animation in milliseconds
let playerNumberEnum = {};
let themes = {};

// Fetch CSS variables
const rootStyles = getComputedStyle(document.documentElement);
let player1Color = rootStyles.getPropertyValue('--player1-color').trim();
let player2Color = rootStyles.getPropertyValue('--player2-color').trim();
let neutralTileColor = rootStyles.getPropertyValue('--neutral-tile-color').trim();
// Set flip animation duration on load
document.styleSheets[0].insertRule(`.flipped { animation: flip ${flipDuration}ms ease-in-out; }`, 0);

// DOM elements
const landingPage = document.getElementById('landing');
const gamePage = document.getElementById('game');
const playerNameInput = document.getElementById('playerName');
const joinButton = document.getElementById('joinButton');
const turnIndicator = document.getElementById('turnIndicator');
const playerList = document.getElementById('playerList');
const themeSelect = document.getElementById('themeSelect');
const boardOrientationSelect = document.getElementById('boardOrientation');

const CURSOR_SHAPES = {
    singleTile: [
        {dx: 0, dy: 0}
    ],
    plus: [
        {dx: 0, dy: 0}, {dx: 0, dy: -1}, {dx: 0, dy: 1}, {dx: -1, dy: 0}, {dx: 1, dy: 0}
    ],
    T: [
        {dx: 0, dy: 0}, {dx: -1, dy: 0}, {dx: 1, dy: 0}, {dx: 0, dy: -1}, {dx: 0, dy: -2}
    ],
    L: [
        {dx: 0, dy: 0}, {dx: 1, dy: 0}, {dx: 2, dy: 0}, {dx: 0, dy: 1}, {dx: 0, dy: 2}
    ],
    LPlus: [
        {dx: -1, dy: -1}, {dx: 0, dy: -1}, {dx: 1, dy: -1}, {dx: 1, dy: 0}, {dx: -1, dy: 1}
    ],
    checker: [
        {dx: -1, dy: -1}, {dx: 1, dy: -1}, {dx: -1, dy: 1}, {dx: 1, dy: 1}
    ],
    line: [
        [{dx: -2, dy: 0}, {dx: -1, dy: 0}, {dx: 0, dy: 0}, {dx: 1, dy: 0}, {dx: 2, dy: 0}], // horizontal
        [{dx: 2, dy: -2}, {dx: 1, dy: -1}, {dx: 0, dy: 0}, {dx: -1, dy: 1}, {dx: -2, dy: 2}], // diagonal
        [{dx: 0, dy: -2}, {dx: 0, dy: -1}, {dx: 0, dy: 0}, {dx: 0, dy: 1}, {dx: 0, dy: 2}], // vertical
        [{dx: -2, dy: -2}, {dx: -1, dy: -1}, {dx: 0, dy: 0}, {dx: 1, dy: 1}, {dx: 2, dy: 2}] // diagonal
    ]
};
let currentShapeKey = 'plus';
let currentCursorShapeIndex = 0;


/* ================================== */
// Socket emitters
/* ================================== */

joinButton.addEventListener('click', () => {
    const playerName = playerNameInput.value.trim() || 'Player';
    const boardOrientation = boardOrientationSelect.value;
    const boardSize = document.getElementById('boardSize').value;
    if (playerName) {
        socket.emit('join', {name: playerName, boardOrientation, boardSize});
        landingPage.style.display = 'none';
        gamePage.style.display = 'block';
    }
});

// themeSelect.addEventListener('change', (event) => {
//     const selectedTheme = event.target.value;
//     socket.emit('requestThemeChange', { playerNumber: player.playerNumber, theme: selectedTheme });
// });

function handleTileClick(x, y) {
    if (!waitingForOpponent && player.playerNumber === currentPlayerNumber) {
        // Prevent flipping the last flipped tile
        if (lastFlippedTile && lastFlippedTile.x === x && lastFlippedTile.y === y) {
            return;
        }

        // Prevent clicking when hovering over own color
        if (board[x][y] === player.playerNumber) {
            return;
        }

        clearHoverEffect(x, y);

        const selectedTiles = [];
        const currentShape = currentShapeKey === 'line'
            ? CURSOR_SHAPES.line[currentCursorShapeIndex]
            : CURSOR_SHAPES[currentShapeKey];

        currentShape.forEach(dir => {
            const newX = x + dir.dx;
            const newY = y + dir.dy;
            if (isValidTile(newX, newY) && board[newX][newY] !== player.playerNumber) {
                selectedTiles.push({x: newX, y: newY});
            }
        });

        socket.emit('move', {player, selectedTiles, clickedTile: {x, y}});
    }
}


/* ================================== */
// Socket listeners
/* ================================== */

socket.on('initializeBoard', (data) => {
    board = data.board;
    console.log('board', board);
    currentPlayerNumber = data.currentPlayerNumber;
    const players = data.players;
    renderBoard();
    updateScores(players);
});

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

// socket.on('receiveThemesAndEnums', (data) => {
//     themes = data.THEMES;
//     playerNumberEnum = data.PLAYER_NUMBER_ENUM;
//     Object.keys(themes).forEach(theme => {
//         const option = document.createElement('option');
//         option.value = theme;
//         option.textContent = theme;
//         themeSelect.appendChild(option);
//     });
// });

socket.on('themeChange', (data) => {
    const { playerNumber, players } = data;
    if (playerNumber !== player.playerNumber) {return;}

    applyTheme(players);
});

socket.on('assignPlayer', (data) => {
    player = data.player;
    waitingForOpponent = data.waitingForOpponent;
    updateTurnIndicator();
});

socket.on('gameOver', (data) => {
    const players = data.players;
    updateScores(players);
    updateTurnIndicator();
    alert('Game over!');
});

document.addEventListener('wheel', (event) => {
    if (!waitingForOpponent && player.playerNumber === currentPlayerNumber) {
        if (currentHoverX !== null && currentHoverY !== null) {
            clearHoverEffect(currentHoverX, currentHoverY);

            const shapeKeys = Object.keys(CURSOR_SHAPES);
            const currentIndex = shapeKeys.indexOf(currentShapeKey);
            if (event.deltaY < 0) {
                currentShapeKey = shapeKeys[(currentIndex + 1) % shapeKeys.length];
            } else {
                currentShapeKey = shapeKeys[(currentIndex - 1 + shapeKeys.length) % shapeKeys.length];
            }

            handleTileHover(currentHoverX, currentHoverY);
        }
    }
});

document.addEventListener('keydown', (event) => {
    if (event.key === 'r' || event.key === 'R') {
        rotateCursorShape();
    }
});

function addTileHoverListeners(tileElement, x, y) {
    tileElement.addEventListener('mouseenter', () => handleTileHover(x, y));
    tileElement.addEventListener('mouseleave', () => handleTileHoverOut(x, y));
}


/* ================================== */
// Helper functions
/* ================================== */

function renderBoard() {
    const boardElement = document.getElementById('board');
    boardElement.innerHTML = ''; // Clear existing board
    const size = board.length;

    boardElement.style.gridTemplateColumns = `repeat(${size}, 30px)`;
    boardElement.style.gridTemplateRows = `repeat(${size}, 30px)`;

    // Render tiles
    board.forEach((row, x) => {
        row.forEach((tileOwner, y) => {
            const tileElement = document.createElement('div');
            tileElement.className = 'tile';

            if (tileOwner === 0) {
                tileElement.style.backgroundColor = neutralTileColor;
            } else {
                tileElement.style.backgroundColor = tileOwner === 1 ? player1Color : player2Color;
            }

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

    // // Render territory borders
    // for (let i = 0; i < 4; i++) {
    //     for (let j = 0; j < 4; j++) {
    //         const territoryBorder = document.createElement('div');
    //         territoryBorder.className = 'territory-border';
    //         territoryBorder.style.left = `${i * 150}px`; // Adjusted for border and gap
    //         territoryBorder.style.top = `${j * 150}px`; // Adjusted for border and gap
    //         boardElement.appendChild(territoryBorder);
    //     }
    // }
}

function rotateCursorShape() {
    if (!waitingForOpponent && player.playerNumber === currentPlayerNumber) {
        if (currentShapeKey === 'line') {
            currentCursorShapeIndex = (currentCursorShapeIndex + 1) % CURSOR_SHAPES.line.length;
        } else {
            const rotatedShape = CURSOR_SHAPES[currentShapeKey].map(({dx, dy}) => ({
                dx: dy,
                dy: -dx
            }));
            CURSOR_SHAPES[currentShapeKey] = rotatedShape;
        }

        if (currentHoverX !== null && currentHoverY !== null) {
            clearHoverEffect();
            handleTileHover(currentHoverX, currentHoverY);
        }
    }
}

function switchShape(newShapeKey) {
    currentShapeKey = newShapeKey;
    currentCursorShapeIndex = 0;
    if (currentHoverX !== null && currentHoverY !== null) {
        clearHoverEffect();
        handleTileHover(currentHoverX, currentHoverY);
    }
}

function clearHoverEffect() {
    const hoverClass1 = 'tile-selector-player1';
    const hoverClass2 = 'tile-selector-player2';
    const invalidClass = 'tile-selector-invalid';

    document.querySelectorAll(`.${hoverClass1}, .${hoverClass2}, .${invalidClass}`).forEach(tile => {
        tile.classList.remove(hoverClass1);
        tile.classList.remove(hoverClass2);
        tile.classList.remove(invalidClass);
    });
}

function handleTileHover(x, y) {
    if (!waitingForOpponent && player.playerNumber === currentPlayerNumber) {
        currentHoverX = x;
        currentHoverY = y;

        clearHoverEffect();

        const hoverClass = player.playerNumber === 1 ? 'tile-selector-player1' : 'tile-selector-player2';
        const invalidClass = 'tile-selector-invalid';
        let isInvalidMove = false;

        // Check if the center tile is invalid
        if (board[x][y] === player.playerNumber || (lastFlippedTile && lastFlippedTile.x === x && lastFlippedTile.y === y)) {
            isInvalidMove = true;
        }

        const currentShape = currentShapeKey === 'line'
        ? CURSOR_SHAPES.line[currentCursorShapeIndex]
        : CURSOR_SHAPES[currentShapeKey];

        currentShape.forEach(({dx, dy}) => {
            const newX = x + dx;
            const newY = y + dy;
            if (isValidTile(newX, newY)) {
                const tileElement = document.querySelector(`.tile[data-x='${newX}'][data-y='${newY}']`);
                if (tileElement) {
                    if (isInvalidMove || board[newX][newY] === player.playerNumber) {
                        tileElement.classList.add(invalidClass);
                    } else {
                        tileElement.classList.add(hoverClass);
                    }
                }
            }
        });

        if (isInvalidMove) {
            currentShape.forEach(({dx, dy}) => {
                const newX = x + dx;
                const newY = y + dy;
                if (isValidTile(newX, newY)) {
                    const tileElement = document.querySelector(`.tile[data-x='${newX}'][data-y='${newY}']`);
                    if (tileElement) {
                        tileElement.classList.add(invalidClass);
                    }
                }
            });
        }
    }
}

function handleTileHoverOut(x, y) {
    if (!waitingForOpponent && player.playerNumber === currentPlayerNumber) {
        clearHoverEffect();
        currentHoverX = null;
        currentHoverY = null;
    }
}

function isValidTile(x, y) {
    return x >= 0 && x < board.length && y >= 0 && y < board[0].length;
}

async function flipTile(x, y, playerNumber) {
    return new Promise((resolve) => {
        const tileElement = document.querySelector(`.tile[data-x='${x}'][data-y='${y}']`);
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
        document.getElementById('youScore').textContent = `${player.name}: ${you.score || 0}%`;
    }

    if (opponent) {
        document.getElementById('opponentScore').textContent = `${opponent.name || 'Opponent'}: ${opponent.score || 0}%`;
    } else {
        document.getElementById('opponentScore').textContent = `Opponent: 0`;
    }
}

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

    document.getElementById('youColor').style.backgroundColor = player.playerNumber === 1 ? selectedTheme.player1Color : selectedTheme.player2Color;
    document.getElementById('opponentColor').style.backgroundColor = player.playerNumber === 1 ? selectedTheme.player2Color : selectedTheme.player1Color;

    renderBoard();
}
