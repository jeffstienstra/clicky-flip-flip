const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const fs = require('fs');

app.use(express.static('public'));

// Board setup
const themes = JSON.parse(fs.readFileSync('themes.json')).themes;
const playerNumberEnum = JSON.parse(fs.readFileSync('playerNumberEnum.json')).playerNumberEnum;
const boardSize = 20;
let board = Array(boardSize).fill().map(() => Array(boardSize).fill(null));
let currentPlayerNumber = 1;
let totalPlayers = 2; // for toggling turns between 2 players. Can support more players
let lastFlippedTile = null; // Track the last flipped tile
const players = {
    player1: {id: null, score: 0, playerNumber: 1, theme: 'Forest'},
    player2: {id: null, score: 0, playerNumber: 2, theme: 'Forest'}
};

// Initialize board with a checkerboard pattern of 5x5 territories
function initializeBoard() {
    for (let i = 0; i < boardSize; i += 5) {
        for (let j = 0; j < boardSize; j += 5) {
            const playerOwner = (i / 5 + j / 5) % 2 === 0 ? 1 : 2;

            for (let x = i; x < i + 5; x++) {
                for (let y = j; y < j + 5; y++) {
                    board[x][y] = playerOwner;
                }
            }
        }
    }
}

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.emit('receiveThemesAndEnums', {themes, playerNumberEnum});

    socket.on('join', (data) => {
        const name = data.name;
        if (!players.player1.id) {
            players.player1.id = socket.id;
            players.player1.name = name;
            socket.emit('assignPlayer', {
                player: {
                    name,
                    playerNumber: 1,
                    score: 0,
                    theme: 'Forest',
                },
                waitingForOpponent: totalPlayers < 2
            });

            if (players.player1.id && players.player2.id) {
                io.emit('turn', currentPlayerNumber); // Notify both players that the game can start
            }
        } else if (!players.player2.id) {
            players.player2.id = socket.id;
            players.player2.name = name;
            socket.emit('assignPlayer', {
                player: {
                    name,
                    playerNumber: 2,
                    score: 0,
                    theme: 'Forest',
                },
                waitingForOpponent: totalPlayers < 2
            });
            if (players.player1.id && players.player2.id) {
                io.emit('turn', currentPlayerNumber); // Notify both players that the game can start
            }
        } else {
            socket.emit('spectator');
        }

        totalPlayers = Object.keys(players).filter(player => players[player].id).length;
        updatePlayerList();
        initializeBoard();
        socket.emit('initializeBoard', {board, currentPlayerNumber, players});
    });

    socket.on('requestThemeChange', (data) => {
        const { playerNumber, theme } = data;

        if (themes[theme]) {
            players[playerNumberEnum[playerNumber]].theme = theme
            io.emit('themeChange', {playerNumber, players});
        }
    });

    socket.on('disconnect', () => {
        resetPlayerScores();

        if (players.player1.id === socket.id) {
            players.player1.id = null;
            players.player2.name = null;
            players.player2.theme = 'Forest';
        } else if (players.player2.id === socket.id) {
            players.player2.id = null;
            players.player2.name = null;
            players.player2.theme = 'Forest';
        }

        totalPlayers = Object.keys(players).filter(player => players[player].id).length;
        lastFlippedTile = null; // to remove the lock icon when the game resets

        updatePlayerList();
        initializeBoard();
        socket.broadcast.emit('playerDisconnected', {board, players, waitingForOpponent: true}); // emit only to remaining player(s)
    });

    function calculatePlayerScore(flippedTiles, player) {
        const playerKey = playerNumberEnum[player.playerNumber];
        players[playerKey].score += flippedTiles.length;
    }

    function resetPlayerScores() {
        Object.keys(players).map(player => players[player].score = 0);
    }

    socket.on('move', async (data) => {
        const {player, x, y} = data;

        if (player.playerNumber === currentPlayerNumber && board[x][y] !== player.playerNumber) {
            board[x][y] = player.playerNumber;  // Use player identifier instead of color
            const captureGroups = [];
            let flippedTiles = captureTiles(x, y, player.playerNumber); // Capture logic

            while (flippedTiles.length > 0) {
                captureGroups.push(flippedTiles);
                const newFlippedTiles = [];
                flippedTiles.forEach(tile => {
                    newFlippedTiles.push(...captureTiles(tile.x, tile.y, player.playerNumber));
                });
                flippedTiles = newFlippedTiles;
            }

            calculatePlayerScore([...(captureGroups.flat() || []), {x, y}], player);
            lastFlippedTile = {x, y}; // Update the last flipped tile

            io.emit('updateGame', {
                board,
                players,
                currentPlayerNumber,
                lastFlipped: lastFlippedTile, // Send the last flipped tile info
                captureGroups
            });

            for (const group of captureGroups) {
                io.emit('captureGroup', group);
                await new Promise(resolve => setTimeout(resolve, 500)); // Wait for the animation to complete
            }

            currentPlayerNumber = togglePlayerTurn();
            io.emit('turn', currentPlayerNumber);
        }
    });

    function togglePlayerTurn() {
        return (currentPlayerNumber % totalPlayers) + 1; // For two players, it will toggle between 1 and 2
    }

    function captureTiles(x, y, color) {
        const directions = [
            {dx: 0, dy: -1}, // Up
            {dx: 0, dy: 1},  // Down
            {dx: -1, dy: 0}, // Left
            {dx: 1, dy: 0}   // Right
        ];

        const capturedTiles = [];
        directions.forEach(dir => {
            const newX = x + dir.dx;
            const newY = y + dir.dy;
            if (isValidTile(newX, newY) && board[newX][newY] !== color) {
                if (isSurrounded(newX, newY, color)) {
                    board[newX][newY] = color;
                    capturedTiles.push({x: newX, y: newY});
                }
            }
        });
        return capturedTiles;
    }

    function isSurrounded(x, y, color) {
        const directions = [
            {dx: 0, dy: -1}, // Up
            {dx: 0, dy: 1},  // Down
            {dx: -1, dy: 0}, // Left
            {dx: 1, dy: 0}   // Right
        ];

        const surroundingTiles = directions.filter(dir => {
            const newX = x + dir.dx;
            const newY = y + dir.dy;
            return isValidTile(newX, newY) && board[newX][newY] === color;
        });

        // Check if the tile is surrounded on at least 3 sides
        return surroundingTiles.length >= 3;
    }

    function isValidTile(x, y) {
        return x >= 0 && x < board.length && y >= 0 && y < board[0].length;
    }

    function updatePlayerList() {
        const playerList = [];
        if (players.player1.id) playerList.push(players.player1);
        if (players.player2.id) playerList.push(players.player2);
        io.emit('updatePlayerList', playerList);
    }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
