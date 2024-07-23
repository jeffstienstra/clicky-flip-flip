let board;
let player = {};
let currentPlayerNumber;
let waitingForOpponent = true;
let lastFlippedTile = null; // Track the last flipped tile
let captureQueue = []; // Queue to manage capture groups
let animating = false; // Flag to indicate if an animation is in progress
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


socket.on('playerDisconnected', (players) => {
    updateScores(players);
    document.getElementById('youColor').style.backgroundColor = player.playerNumber === 1 ? player1Color : player2Color;
    document.getElementById('opponentColor').style.backgroundColor = 'black';
});

// Listen for themes from the server
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

// Join button event listener
joinButton.addEventListener('click', () => {
    const playerName = playerNameInput.value.trim();
    if (playerName) {
        socket.emit('join', {name: playerName});
        landingPage.style.display = 'none';
        gamePage.style.display = 'block';
    }
});

// Event listener for theme selection
themeSelect.addEventListener('change', (event) => {
    const selectedTheme = event.target.value;
    socket.emit('requestThemeChange', { playerNumber: player.playerNumber, theme: selectedTheme });
});

// Apply theme to the client
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

// Listen for theme change confirmation from server
socket.on('themeChange', (data) => {
    const { playerNumber, players } = data;
    if (playerNumber !== player.playerNumber) {return;}

    applyTheme(players);
});

// Listen for board initialization from server
socket.on('initializeBoard', (data) => {
    board = data.board;
    currentPlayerNumber = data.currentPlayerNumber;
    const players = data.players;
    renderBoard();
    updateScores(players);
});

// Listen for player assignment
socket.on('assignPlayer', (data) => {
    player = data.player;
    waitingForOpponent = data.waitingForOpponent;
    updateTurnIndicator();
});

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
    if (!waitingForOpponent && player.playerNumber === currentPlayerNumber && board[x][y] !== player.playerNumber) {
        // Prevent flipping the last flipped tile
        if (lastFlippedTile && lastFlippedTile.x === x && lastFlippedTile.y === y) {
            return;
        }
        socket.emit('move', {player, x, y}); // Emit player identifier
    }
}

// Listen for turn updates from server
socket.on('turn', (newCurrentPlayerNumber) => {
    currentPlayerNumber = newCurrentPlayerNumber;
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
                tileElement.style.backgroundColor = player === 1 ? player1Color : player2Color;
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
    const {board: newBoard, players, currentPlayerNumber: newCurrentPlayerNumber, lastFlipped, captureGroups} = data;
    board = newBoard;
    currentPlayerNumber = newCurrentPlayerNumber;
    lastFlippedTile = lastFlipped; // Update the last flipped tile
    updateScores(players);

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
    const you = Object.values(players).find(p => p.id === socket.id);
    const opponent = Object.values(players).find(p => p.id !== socket.id);

    if (you) {
        document.getElementById('youColor').style.backgroundColor = player.playerNumber === 1 ? player1Color : player2Color;
        document.getElementById('youScore').textContent = `${player.name}: ${you.score || 0}`;
    }

    if (opponent) {
        document.getElementById('opponentColor').style.backgroundColor = player.playerNumber === 1 ? player2Color : player1Color;
        document.getElementById('opponentScore').textContent = `Opponent: ${opponent.score || 0}`;
    }
});

// Function to update turn indicator
function updateTurnIndicator() {
    if (waitingForOpponent) {
        turnIndicator.textContent = "Waiting for an opponent to join...";
    } else if (player.playerNumber === currentPlayerNumber) {
        turnIndicator.textContent = "It's your turn!";
    } else {
        turnIndicator.textContent = "Waiting for opponent's turn...";
    }
}

// Function to update scores
function updateScores(players) {
    if (players.length < 2) {
        //reset scores
        document.getElementById('youScore').textContent = `${player.name}: 0`;
        document.getElementById('opponentScore').textContent = `Opponent: 0`;
        renderBoard();
        return;
    } else if (players.player1 && players.player2) {
        const you = Object.values(players).find(p => p.id === socket.id);
        const opponent = Object.values(players).find(p => p.id !== socket.id);

        document.getElementById('youScore').textContent = `${player.name}: ${you.score || 0}`;
        document.getElementById('opponentScore').textContent = `Opponent: ${opponent.score}`;
    }
}
