const socket = io();
let board;
let player = {};
let winPercentage;
let currentPlayerNumber;
let waitingForOpponent = true; // only 1 player has joined the game (this is not the turn indicator)
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
const waitIndicator = document.getElementById('waitIndicator');

const CURSOR_SHAPES = {
    singleTile: [
        {dx: 0, dy: 0}
    ],
    doubleTile: [
        {dx: 0, dy: 0}, {dx: 0, dy: -1}
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
        // [{dx: 2, dy: -2}, {dx: 1, dy: -1}, {dx: 0, dy: 0}, {dx: -1, dy: 1}, {dx: -2, dy: 2}], // diagonal
        [{dx: 0, dy: -2}, {dx: 0, dy: -1}, {dx: 0, dy: 0}, {dx: 0, dy: 1}, {dx: 0, dy: 2}], // vertical
        // [{dx: -2, dy: -2}, {dx: -1, dy: -1}, {dx: 0, dy: 0}, {dx: 1, dy: 1}, {dx: 2, dy: 2}] // diagonal
    ]
};

const cursorConfig = { // Available cursor shapes for each board size and orientation
    standard: {
        4: ['singleTile', 'doubleTile'],
        8: ['singleTile', 'doubleTile', 'plus', 'T', 'L'],
        20: ['singleTile', 'doubleTile', 'plus', 'T', 'L', 'LPlus', 'checker', 'line']
    },
    checkerboard: {
        8: ['singleTile', 'doubleTile', 'plus', 'T', 'L'],
        20: ['singleTile', 'doubleTile', 'plus', 'T', 'L', 'LPlus', 'checker', 'line']
    },
    islands: {
        20: ['singleTile', 'doubleTile', 'plus', 'T', 'L', 'LPlus', 'checker', 'line']
    },
    topBottomSplit: {
        8: ['singleTile', 'doubleTile', 'plus', 'T', 'L'],
        20: ['singleTile', 'doubleTile', 'plus', 'T', 'L', 'LPlus', 'checker', 'line']
    }
};

let currentCursorKey = 'plus';
let currentCursorShapeIndex = 0;

/* ================================== */
// Socket emitters
/* ================================== */
//#region
joinButton.addEventListener('click', () => {
    const playerName = playerNameInput.value.trim() || '';
    const boardOrientation = boardOrientationSelect.value;
    const boardSize = document.getElementById('boardSize').value;

    socket.emit('join', {name: playerName, boardOrientation, boardSize});
    landingPage.style.display = 'none';
    gamePage.style.display = 'block';
});

document.addEventListener('mousemove', (event) => {
    waitIndicator.style.left = `${event.pageX- 25}px`;
    waitIndicator.style.top = `${event.pageY - 0}px`;
});

// themeSelect.addEventListener('change', (event) => {
//     const selectedTheme = event.target.value;
//     socket.emit('requestThemeChange', { playerNumber: player.playerNumber, theme: selectedTheme });
// });

function handleTileClick(x, y) {
    if (!waitingForOpponent && player?.playerNumber === currentPlayerNumber) {
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
        const cursorShape = currentCursorKey === 'line'
            ? CURSOR_SHAPES.line[currentCursorShapeIndex]
            : CURSOR_SHAPES[currentCursorKey];

        cursorShape.forEach(dir => {
            const newX = x + dir.dx;
            const newY = y + dir.dy;
            if (isValidTile(newX, newY) && board[newX][newY] !== player.playerNumber) {
                selectedTiles.push({x: newX, y: newY});
            }
        });

        socket.emit('move', {player, selectedTiles, clickedTile: {x, y}});
    }
}

//#endregion

/* ================================== */
// Socket listeners
/* ================================== */
//#region
socket.on('initializeBoard', (data) => {
    board = data.board;
    currentPlayerNumber = data.currentPlayerNumber;
    const players = data.players;
    renderBoard();
    updateScores(players);
    updateWinPercentageLabel(data.winPercentage);
});

socket.on('updateGame', async (data) => {
    board = data.board;
    const captureGroups = data.captureGroups || [];
    currentPlayerNumber = data.currentPlayerNumber;
    lastFlippedTile = data.lastFlippedTile;
    players = data.players;
    waitingForOpponent = data.waitingForOpponent;
    winPercentage = data.winPercentage;

    updateScores(players);
    updateWinPercentageLabel(winPercentage);

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

socket.on('gameOver', async (data) => {
    const players = data.players;
    await updateScores(players);
    setGameOverState(players);
});

document.addEventListener('wheel', (event) => {
    if (!waitingForOpponent && player?.playerNumber === currentPlayerNumber) {
        if (currentHoverX !== null && currentHoverY !== null) {
            clearHoverEffect(currentHoverX, currentHoverY);

            const shapeKeys = Object.keys(CURSOR_SHAPES);
            const currentIndex = shapeKeys.indexOf(currentCursorKey);
            if (event.deltaY < 0) {
                currentCursorKey = shapeKeys[(currentIndex + 1) % shapeKeys.length];
            } else {
                currentCursorKey = shapeKeys[(currentIndex - 1 + shapeKeys.length) % shapeKeys.length];
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

//#endregion

/* ================================== */
// Helper functions
/* ================================== */
//#region
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
    if (!waitingForOpponent && player?.playerNumber === currentPlayerNumber) {
        if (currentCursorKey === 'line') {
            currentCursorShapeIndex = (currentCursorShapeIndex + 1) % CURSOR_SHAPES.line.length;
        } else {
            const rotatedShape = CURSOR_SHAPES[currentCursorKey].map(({dx, dy}) => ({
                dx: dy,
                dy: -dx
            }));
            CURSOR_SHAPES[currentCursorKey] = rotatedShape;
        }

        if (currentHoverX !== null && currentHoverY !== null) {
            clearHoverEffect();
            handleTileHover(currentHoverX, currentHoverY);
        }
    }
}

function switchShape(newShapeKey) {
    currentCursorKey = newShapeKey;
    currentCursorShapeIndex = 0;
    if (currentHoverX !== null && currentHoverY !== null) {
        clearHoverEffect();
        handleTileHover(currentHoverX, currentHoverY);
    }
}

function clearHoverEffect() {
    const hoverClass1 = 'tile-selector-player1';
    const hoverClass2 = 'tile-selector-player2';
    const hoverClassOpponent = 'tile-selector-opponent';
    const invalidOpponentClass = 'tile-selector-opponent-invalid';
    const invalidClass = 'tile-selector-invalid';

    document.querySelectorAll(`
        .${hoverClass1},
        .${hoverClass2},
        .${hoverClassOpponent},
        .${invalidOpponentClass},
        .${invalidClass}`).forEach(tile => {
        tile.classList.remove(hoverClass1);
        tile.classList.remove(hoverClass2);
        tile.classList.remove(hoverClassOpponent);
        tile.classList.remove(invalidOpponentClass);
        tile.classList.remove(invalidClass);
    });
}

const throttledEmitTileHover = throttle((x, y, cursorShape) => {
    socket.emit('tileHover', {x, y, cursorShape});
}, 250);

const throttledEmitTileHoverOut = throttle((x, y) => {
    socket.emit('tileHoverOut');
})

function handleTileHover(x, y) {
    if (!waitingForOpponent && player.playerNumber === currentPlayerNumber) {

        const cursorShape = getCursorShape();
        throttledEmitTileHover(x, y, cursorShape);

        currentHoverX = x;
        currentHoverY = y;

        clearHoverEffect();

        const hoverClass = player.playerNumber === 1 ? 'tile-selector-player1' : 'tile-selector-player2';
        const invalidClass = 'tile-selector-invalid';

        const isInvalidMove = checkInvalidMove(x, y);

        if (isInvalidMove) {
            applyInvalidHoverEffect(x, y, cursorShape, invalidClass);
        } else {
            applyHoverEffect(x, y, cursorShape, hoverClass, invalidClass);
        }
    } else {
        waitIndicator.style.display = 'block'; // Show the 'wait' indicator
    }
}

function handleOpponentTileHover(x, y, opponentCursorShape) {
    const cursorShape = getCursorShape(opponentCursorShape);

    clearHoverEffect();

    const hoverClass = 'tile-selector-opponent';
    const invalidClass = 'tile-selector-opponent-invalid';

    applyHoverEffect(x, y, cursorShape, hoverClass, invalidClass);
}

socket.on('tileHover', (data) => {
    const {x, y, cursorShape, playerId} = data;
    if (playerId !== socket.id) {
        handleOpponentTileHover(x, y, cursorShape);
    }
});

socket.on('tileHoverOut', (data) => {
    const {playerId} = data;
    if (playerId !== socket.id) {
        clearHoverEffect();
    }
});

function getCursorShape(opponentCursorShape) {
    if (opponentCursorShape) {
        return opponentCursorShape;
    } else {
        return currentCursorKey === 'line'
            ? CURSOR_SHAPES.line[currentCursorShapeIndex]
            : CURSOR_SHAPES[currentCursorKey];
    }
}

function applyHoverEffect(x, y, cursorShape, hoverClass, invalidClass) {
    cursorShape.forEach(({dx, dy}) => {
        const newX = x + dx;
        const newY = y + dy;
        if (isValidTile(newX, newY)) {
            const tileElement = document.querySelector(`.tile[data-x='${newX}'][data-y='${newY}']`);
            if (tileElement) {
                tileElement.classList.add(hoverClass);
            }
        }
    });
}

function applyInvalidHoverEffect(x, y, cursorShape, invalidClass) {
    cursorShape.forEach(({dx, dy}) => {
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

function checkInvalidMove(x, y) {
    return board[x][y] === player.playerNumber || (lastFlippedTile && lastFlippedTile.x === x && lastFlippedTile.y === y);
}

socket.on('opponentTileHover', (data) => {
    const {x, y, cursorShape, opponentId} = data;

    if (opponentId !== socket.id) {return}

    clearHoverEffect();

    handleTileHover(x, y, cursorShape);

})

function handleTileHoverOut(x, y) {
    if (!waitingForOpponent && player.playerNumber === currentPlayerNumber) {
        throttledEmitTileHoverOut(x, y);

        clearHoverEffect();
    }
    waitIndicator.style.display = 'none';
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
        turnIndicator.textContent = "Your turn!";
    } else {
        turnIndicator.textContent = "Opponent's turn...";
    }
}

function updateWinPercentageLabel(winPercentage) {
    const label = document.getElementById('winPercentageLabel');
    label.textContent = `Goal: ${winPercentage || '-'}%`;
}

function setGameOverState(players) {
    const you = Object.values(players).find(p => p.id === socket.id);
    const opponent = Object.values(players).find(p => p.id !== socket.id);

    const gameOverMessage = `${you.score >= winPercentage ? `${you.name || 'You'} win!` : 'You lose.'} ${you.score}% to ${opponent.score}%`;

    // Show the custom modal dialog
    const modal = document.getElementById('gameOverModal');
    const message = document.getElementById('gameOverMessage');
    const button = document.getElementById('gameOverButton');

    message.textContent = gameOverMessage;
    modal.style.display = 'block';

    button.onclick = function() {
        modal.style.display = 'none';
        location.reload(); // Reload the page when the button is pressed
    };
}

function updateScores(players) {
    return new Promise((resolve) => {
        const you = Object.values(players).find(p => p.id === socket.id);
        const opponent = Object.values(players).find(p => p.id !== socket.id);

        if (you) {
            document.getElementById('youScore').textContent = `${player.name || 'You'}: ${you.score || 0}%`;
        }

        if (opponent) {
            document.getElementById('opponentScore').textContent = `${opponent.name || 'Opponent'}: ${opponent.score || 0}%`;
        }

        updateProgressBar(players);

        // Wait for animations to complete before resolving the Promise
        setTimeout(() => {
            resolve();
        }, 500); // the FLIP_DURATION. Use the duration of the longest animation
    });
}

function updateProgressBar(players) {
    const you = Object.values(players).find(p => p.id === socket.id);
    const opponent = Object.values(players).find(p => p.id !== socket.id);

    if (you) {
        const player1Percentage = you.playerNumber === 1 ? you.score : opponent.score;
        const player1Progress = (player1Percentage / winPercentage) * 50; // 50% is the center
        document.getElementById('player1Progress').style.width = `${player1Progress}%`;
    }

    if (opponent) {
        const player2Percentage = you.playerNumber === 2 ? you.score : opponent.score;
        const player2Progress = (player2Percentage / winPercentage) * 50; // 50% is the center
        document.getElementById('player2Progress').style.width = `${player2Progress}%`;
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

function throttle(func, limit) {
    let lastFunc;
    let lastRan;
    return function(...args) {
        const context = this;
        if (!lastRan) {
            func.apply(context, args);
            lastRan = Date.now();
        } else {
            clearTimeout(lastFunc);
            lastFunc = setTimeout(function() {
                if ((Date.now() - lastRan) >= limit) {
                    func.apply(context, args);
                    lastRan = Date.now();
                }
            }, limit - (Date.now() - lastRan));
        }
    };
}

//#endregion