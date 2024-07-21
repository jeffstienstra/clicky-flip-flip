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

let board = Array(20).fill().map(() => Array(20).fill(null));
let currentPlayer = 'player1';
let lastFlippedTile = null; // Track the last flipped tile
const players = {
    player1: {id: null, score: 0},
    player2: {id: null, score: 0}
};
let player1Color;
let player2Color;

// Initialize board with a checkerboard pattern of 5x5 territories
function initializeBoard() {
    for (let i = 0; i < 20; i += 5) {
        for (let j = 0; j < 20; j += 5) {
            const color = (i / 5 + j / 5) % 2 === 0 ? 'player1' : 'player2';
            for (let x = i; x < i + 5; x++) {
                for (let y = j; y < j + 5; y++) {
                    board[x][y] = color;
                }
            }
        }
    }
}

function calculateScores(flippedTiles, player) {
    players[player].score += flippedTiles.length;
}

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('requestThemes', () => {
        socket.emit('receiveThemes', themes);
    });

    socket.on('join', (data) => {
        const name = data.name;
        player1Color = data.player1Color;
        player2Color = data.player2Color;
        if (!players.player1.id) {
            players.player1.id = socket.id;
            players.player1.name = name;
            socket.emit('assignPlayer', {player: 'player1', color: player1Color, currentPlayer, waitingForOpponent: !players.player2.id});
        } else if (!players.player2.id) {
            players.player2.id = socket.id;
            players.player2.name = name;
            socket.emit('assignPlayer', {player: 'player2', color: player2Color, currentPlayer, waitingForOpponent: false});
            io.emit('turn', currentPlayer); // Notify both players that the game can start
        } else {
            socket.emit('spectator');
        }

        updatePlayerList();
        initializeBoard();
        socket.emit('initializeBoard', {board, currentPlayer, scores: {player1Score: players.player1.score, player2Score: players.player2.score}});
    });

    socket.on('requestThemeChange', (data) => {
        const { theme } = data;
        if (themes[theme]) {
            player1Color = themes[theme].player1Color;
            player2Color = themes[theme].player2Color;
            io.emit('themeChange', themes[theme]);
            updatePlayerList();
            initializeBoard(); // Reinitialize the board with new colors
        } else {
            player1Color = themes['Forest'].player1Color;
            player2Color = themes['Forest'].player2Color;
            socket.emit('themeChange', themes['Forest']); // Fallback to default theme
            updatePlayerList();
        }
    });

    socket.on('disconnect', () => {
        if (players.player1.id === socket.id) {
            delete players.player1.id;
        } else if (players.player2.id === socket.id) {
            delete players.player2.id;
        }
        updatePlayerList();
    });

    socket.on('move', async (data) => {
        const {player, x, y} = data;

        if (player === currentPlayer && board[x][y] !== player) {
            board[x][y] = player;  // Use player identifier instead of color
            const captureGroups = [];
            let flippedTiles = captureTiles(x, y, player); // Capture logic

            while (flippedTiles.length > 0) {
                captureGroups.push(flippedTiles);
                const newFlippedTiles = [];
                flippedTiles.forEach(tile => {
                    newFlippedTiles.push(...captureTiles(tile.x, tile.y, player));
                });
                flippedTiles = newFlippedTiles;
            }

            calculateScores([...(captureGroups.flat() || []), {x, y}], player);
            lastFlippedTile = {x, y}; // Update the last flipped tile

            io.emit('updateGame', {
                board,
                scores: {player1Score: players.player1.score, player2Score: players.player2.score},
                currentPlayer,
                lastFlipped: lastFlippedTile, // Send the last flipped tile info
                captureGroups
            });

            for (const group of captureGroups) {
                io.emit('captureGroup', group);
                await new Promise(resolve => setTimeout(resolve, 500)); // Wait for the animation to complete
            }

            currentPlayer = currentPlayer === 'player1' ? 'player2' : 'player1';
            io.emit('turn', currentPlayer);
        }
    });

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
                    console.log(`Capturing tile at (${newX}, ${newY})`);
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
        console.log('playerList:', playerList);
        io.emit('updatePlayerList', playerList);
    }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
