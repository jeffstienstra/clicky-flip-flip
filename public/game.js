let board;
let player;
let currentPlayer;
let opponent;
let waitingForOpponent = false;
let lastFlippedTile = null; // Track the last flipped tile
let captureQueue = []; // Queue to manage capture groups
let animating = false; // Flag to indicate if an animation is in progress
let flipDuration = 500; // Duration of the flip animation in milliseconds

const socket = io();

// Fetch CSS variables
const rootStyles = getComputedStyle(document.documentElement);
let player1Color = rootStyles.getPropertyValue('--player1-color').trim();
let player2Color = rootStyles.getPropertyValue('--player2-color').trim();

// DOM elements
const landingPage = document.getElementById('landing');
const gamePage = document.getElementById('game');
const playerNameInput = document.getElementById('playerName');
const joinButton = document.getElementById('joinButton');
const turnIndicator = document.getElementById('turnIndicator');
const playerList = document.getElementById('playerList');
const themeSelect = document.getElementById('themeSelect');

// Fetch themes from the server on connection
socket.on('connect', () => {
    socket.emit('requestThemes');
});

// Listen for themes from the server
socket.on('receiveThemes', (themes) => {
    Object.keys(themes).forEach(theme => {
        const option = document.createElement('option');
        option.value = theme;
        option.textContent = theme;
        themeSelect.appendChild(option);
    });
});

// Join button event listener
joinButton.addEventListener('click', () => {
    const playerName = playerNameInput.value.trim();
    if (playerName) {
        socket.emit('join', {name: playerName, player1Color, player2Color});
        landingPage.style.display = 'none';
        gamePage.style.display = 'block';
    }
});

// Event listener for theme selection
themeSelect.addEventListener('change', (event) => {
    const selectedTheme = event.target.value;
    socket.emit('requestThemeChange', { theme: selectedTheme });
});

// Apply theme to the client
function applyTheme(theme) {
    player1Color = theme.player1Color;
    player2Color = theme.player2Color;
    document.documentElement.style.setProperty('--player1-color', theme.player1Color);
    document.documentElement.style.setProperty('--player2-color', theme.player2Color);
    document.documentElement.style.setProperty('--background-color', theme.backgroundColor);
    document.documentElement.style.setProperty('--board-color', theme.boardColor);
    document.documentElement.style.setProperty('--board-border-color', theme.boardBorderColor);
    document.documentElement.style.setProperty('--tile-border-color', theme.tileBorderColor);
    document.documentElement.style.setProperty('--territory-border-color', theme.territoryBorderColor);
    document.documentElement.style.setProperty('--text-color', theme.textColor);

    // Update the scoreboard colors
    document.getElementById('youColor').style.backgroundColor = player === 'player1' ? player1Color : player2Color;
    document.getElementById('opponentColor').style.backgroundColor = player === 'player1' ? player2Color : player1Color;
}

// Listen for theme change confirmation from server
socket.on('themeChange', (theme) => {
    applyTheme(theme);
    renderBoard();
});

// Listen for board initialization from server
socket.on('initializeBoard', (data) => {
    board = data.board;
    currentPlayer = data.currentPlayer;
    renderBoard();
    updateScores(data.scores);
});

// Listen for player assignment
socket.on('assignPlayer', (data) => {
    player = data.player;
    opponent = player === 'player1' ? 'player2' : 'player1';
    waitingForOpponent = data.waitingForOpponent;
    updateTurnIndicator();

    // Update the scoreboard colors
    document.getElementById('youColor').style.backgroundColor = player === 'player1' ? player1Color : player2Color;
    document.getElementById('opponentColor').style.backgroundColor = player === 'player1' ? player2Color : player1Color;
});

// Function to render the board
function renderBoard() {
    const boardElement = document.getElementById('board');
    boardElement.innerHTML = ''; // Clear existing board

    // Render tiles
    board.forEach((row, x) => {
        row.forEach((tilePlayer, y) => {
            const tileElement = document.createElement('div');
            tileElement.className = 'tile';
            tileElement.style.backgroundColor = tilePlayer === 'player1' ? player1Color : player2Color;
            tileElement.dataset.x = x;
            tileElement.dataset.y = y;
            tileElement.addEventListener('click', () => handleTileClick(x, y));

            // Add lock icon if this tile is locked
            if (lastFlippedTile && lastFlippedTile.x === x && lastFlippedTile.y === y) {
                const lockIcon = document.createElement('span');
                lockIcon.className = 'lock-icon';
                lockIcon.textContent = '🔒'; // Unicode lock icon
                tileElement.appendChild(lockIcon);
            }

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
    if (player === currentPlayer && board[x][y] !== player) {
        console.log('player:', player);
        // Prevent flipping the last flipped tile
        if (lastFlippedTile && lastFlippedTile.x === x && lastFlippedTile.y === y) {
            return;
        }
        socket.emit('move', {player, x, y}); // Emit player identifier
    }
}

// Listen for turn updates from server
socket.on('turn', (newCurrentPlayer) => {
    currentPlayer = newCurrentPlayer;
    waitingForOpponent = false;
    updateTurnIndicator();
});

// Function to flip a tile
async function flipTile(x, y, player) {
    return new Promise((resolve) => {
        const tileElement = document.querySelector(`.tile[data-x='${x}'][data-y='${y}']`);
        if (tileElement) {
            tileElement.classList.add('flipped');
            setTimeout(() => {
                tileElement.style.backgroundColor = player === 'player1' ? player1Color : player2Color;
            }, (flipDuration * 0.5)); // Change color at the halfway point of the animation
            setTimeout(() => {
                tileElement.classList.remove('flipped');
                resolve(); // Resolve the promise after the animation completes
            }, flipDuration); // Match the duration of the animation
        } else {
            resolve();
        }
    });
}

// Function to flip a group of tiles
async function flipGroup(tiles, player) {
    const flipPromises = tiles.map(({x, y}) => flipTile(x, y, player));
    await Promise.all(flipPromises);
}

// Listen for updateGame event
socket.on('updateGame', async (data) => {
    const {board: newBoard, scores, currentPlayer: newCurrentPlayer, lastFlipped, captureGroups} = data;
    board = newBoard;
    console.log('board:', board);
    console.log('newBoard[lastFlipped.x][lastFlipped.y]:', newBoard[lastFlipped.x][lastFlipped.y]);
    currentPlayer = newCurrentPlayer;
    lastFlippedTile = lastFlipped; // Update the last flipped tile
    updateScores(scores);

    // Flip the last flipped tile first
    await flipTile(lastFlipped.x, lastFlipped.y, newBoard[lastFlipped.x][lastFlipped.y]);

    // Add the lock icon after the first tile flip completes
    const tileElement = document.querySelector(`.tile[data-x='${lastFlipped.x}'][data-y='${lastFlipped.y}']`);
    if (tileElement) {
        const lockIcon = document.createElement('span');
        lockIcon.className = 'lock-icon';
        lockIcon.textContent = '🔒'; // Unicode lock icon
        tileElement.appendChild(lockIcon);
    }

    // Sequentially animate each capture group
    for (const group of captureGroups) {
        await flipGroup(group, newBoard[group[0].x][group[0].y]);
    }

    // Finally render the board
    renderBoard();
});

// Handle spectators
socket.on('spectator', () => {
    alert('You are a spectator. Wait for a player slot to open up.');
});

// Listen for player list update
socket.on('updatePlayerList', (players) => {
    console.log('players:', players);
    const you = players.find(p => p.id === socket.id);
    const opponentPlayer = players.find(p => p.id !== socket.id);

    if (you) {
        document.getElementById('youColor').style.backgroundColor = player === 'player1' ? player1Color : player2Color;
        document.getElementById('youScore').textContent = `You: ${you.score || 0}`;
    }

    if (opponentPlayer) {
        document.getElementById('opponentColor').style.backgroundColor = player === 'player1' ? player2Color : player1Color;
        document.getElementById('opponentScore').textContent = `Opponent: ${opponentPlayer.score || 0}`;
    }
});

// Function to update turn indicator
function updateTurnIndicator() {
    if (waitingForOpponent) {
        turnIndicator.textContent = "Waiting for an opponent to join...";
    } else if (player === currentPlayer) {
        turnIndicator.textContent = "It's your turn!";
    } else {
        turnIndicator.textContent = "Waiting for opponent's turn...";
    }
}

// Function to update scores
function updateScores(scores) {
    if (scores) {
        const youScore = player === 'player1' ? scores.player1Score : scores.player2Score;
        const opponentScore = player === 'player1' ? scores.player2Score : scores.player1Score;
        document.getElementById('youScore').textContent = `You: ${youScore}`;
        document.getElementById('opponentScore').textContent = `Opponent: ${opponentScore}`;
    }
}

// Initial connection to request the board
window.onload = () => {
    socket.emit('requestBoard');
};

// Update flip duration dynamically
document.styleSheets[0].insertRule(`.flipped { animation: flip ${flipDuration}ms ease-in-out; }`, 0);
