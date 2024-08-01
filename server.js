const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));

// Constants
const BOARD_SIZE = 20;
const FLIP_DURATION = 500; // Duration of the flip animation in milliseconds
const MAX_PLAYERS_PER_GAME = 2;
const CARDINAL_DIRECTIONS = [
    {dx: 0, dy: -1}, // Up
    {dx: 0, dy: 1},  // Down
    {dx: -1, dy: 0}, // Left
    {dx: 1, dy: 0}   // Right
];
const DIAGONAL_DIRECTIONS = [
    {dx: -1, dy: -1}, // Top-left
    {dx: -1, dy: 1},  // Bottom-left
    {dx: 1, dy: -1},  // Top-right
    {dx: 1, dy: 1}    // Bottom-right
];
const ALL_DIRECTIONS = CARDINAL_DIRECTIONS.concat(DIAGONAL_DIRECTIONS);
const islandShapes = [
    // main island
    [
        {dx: -2, dy: -2}, {dx: -1, dy: -2}, {dx: 0, dy: -2},
        {dx: -1, dy: -1}, {dx: 0, dy: -1}, {dx: 1, dy: -1},
        {dx: -1, dy: 0}, {dx: 0, dy: 0}, {dx: 1, dy: 0},
        {dx: -1, dy: 1}, {dx: 0, dy: 1}, {dx: 1, dy: 1},
        {dx: 0, dy: 2}, {dx: 1, dy: 2}, {dx: 2, dy: 2},
    ],
    // small island
    [
        {dx: 0, dy: -1}, {dx: 1, dy: -1},
        {dx: -1, dy: 0}, {dx: 0, dy: 0}, {dx: 1, dy: 0},
        {dx: -1, dy: 1}, {dx: 0, dy: 1},
    ],
];
// Load external data
const THEMES = JSON.parse(fs.readFileSync('themes.json')).themes;
const PLAYER_NUMBER_ENUM = JSON.parse(fs.readFileSync('playerNumberEnum.json')).playerNumberEnum;

// Game state
const games = {};
let boardOrientation;
let board;

function initializeBoard() {
    board = Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(null));
    switch (boardOrientation) {
        case 'checkerboard':
            for (let i = 0; i < BOARD_SIZE; i += 5) {
                for (let j = 0; j < BOARD_SIZE; j += 5) {
                    const playerOwner = (i / 5 + j / 5) % 2 === 0 ? 1 : 2;
                    for (let x = i; x < i + 5; x++) {
                        for (let y = j; y < j + 5; y++) {
                            board[x][y] = playerOwner;
                        }
                    }
                }
            }
            break;
            case 'islands':
                createRandomIslands();
                break;
            case 'topBottomSplit':
                for (let y = 0; y < BOARD_SIZE; y++) {
                    for (let x = 0; x < BOARD_SIZE; x++) {
                        if (x < BOARD_SIZE / 2) {
                            if (x === 0 || y === 0 || y === BOARD_SIZE - 1) {
                                board[x][y] = 2; // Player 2's color
                            } else {
                                board[x][y] = 1; // Player 1's color
                            }
                        } else {
                            if (x === BOARD_SIZE - 1 || y === 0 || y === BOARD_SIZE - 1) {
                                board[x][y] = 1; // Player 1's color
                            } else {
                                board[x][y] = 2; // Player 2's color
                            }
                        }
                    }
                }
                break;
            default:
                console.log('Unknown board orientation:', boardOrientation);
                break;
    }
    return board;
}

function createRandomIslands() {
    // Step 1: Split the board into two halves
    for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
            if (y < BOARD_SIZE / 2) {
                board[x][y] = 1; // Player 1's half
            } else {
                board[x][y] = 2; // Player 2's half
            }
        }
    }

    // Step 2: Generate islands for player 1 in player 2's half
    placeIsland(islandShapes[0], 1, BOARD_SIZE - 5, BOARD_SIZE - 5);
    placeIsland(islandShapes[1], 1, 3, BOARD_SIZE - 6);

    // Step 3: Generate islands for player 2 in player 1's half
    placeIsland(islandShapes[0], 2, 4, 4);
    placeIsland(islandShapes[1], 2, BOARD_SIZE - 4, 5);
}

function placeIsland(shape, playerNumber, startX, startY) {
    console.log('startX:', startX, 'startY:', startY);
    shape.forEach(({dx, dy}) => {
        const x = startX + dx;
        const y = startY + dy;
        if (isValidTile(x, y) && board[x][y] !== playerNumber && !isEdgeTile(x, y) && !isCenterColumnTile(x)) {
            board[x][y] = playerNumber;
        }
    });
}

function isValidTile(x, y) {
    return x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE;
}

function isEdgeTile(x, y) {
    return x < 1 || x >= BOARD_SIZE - 1 || y < 1 || y >= BOARD_SIZE - 1;
}

function isCenterColumnTile(x) {
    return x === Math.floor(BOARD_SIZE / 2) - 1 || x === Math.floor(BOARD_SIZE / 2);
}

function createGame() {
    const gameRoom = `game_${Object.keys(games).length + 1}`;
    games[gameRoom] = {
        // board: initializeBoard(boardOrientation),
        currentPlayerNumber: 1,
        lastFlippedTile: null,
        players: [],
        boardOrientation: 'checkerboard' // Default orientation
    };
    return gameRoom;
}

function findOrCreateGameRoom() {
    let gameRoom = Object.keys(games).find(room => games[room].players.length < MAX_PLAYERS_PER_GAME);
    if (!gameRoom) {
        gameRoom = createGame();
    }
    return gameRoom;
}

function getPlayerRoom(socketId) {
    return Object.keys(games).find(room => games[room].players.some(p => p.id === socketId));
}

function addPlayerToGame(socket, name) {
    const gameRoom = findOrCreateGameRoom();
    const playerNumber = games[gameRoom].players.length + 1;
    const player = {
        id: socket.id,
        name,
        playerNumber,
        score: 0,
        theme: 'SNES'
    };
    games[gameRoom].players.push(player);
    socket.join(gameRoom);
    return {gameRoom, player};
}

function removePlayerFromGame(socketId) {
    const gameRoom = getPlayerRoom(socketId);
    if (gameRoom) {
        games[gameRoom].players = games[gameRoom].players.filter(p => p.id !== socketId);
        games[gameRoom].lastFlippedTile = null; // Remove lock icon when game resets
        // if (games[gameRoom].players.length === 0) {
        //     delete games[gameRoom];
        // }
    }
    return gameRoom;
}

function calculatePlayerScore(flippedTiles, player, gameRoom) {
    const playerInGame = games[gameRoom].players.find(p => p.id === player.id);
    if (playerInGame) {
        playerInGame.score += flippedTiles.length;
    }
}

function resetPlayerScores(gameRoom) {
    const game = games[gameRoom];
    game?.players?.forEach(player => player.score = 0);
}

function togglePlayerTurn(game) {
    return (game.currentPlayerNumber % MAX_PLAYERS_PER_GAME) + 1; // For two players, it will toggle between 1 and 2
}

function isSurrounded(x, y, playerNumber, game) {
    const surroundingTiles = CARDINAL_DIRECTIONS.filter(dir => {
        const newX = x + dir.dx;
        const newY = y + dir.dy;
        return isValidTile(newX, newY) && game.board[newX][newY] === playerNumber;
    });

    // Check if the tile is surrounded on at least 3 sides
    return surroundingTiles.length >= 3;
}

function captureTiles(x, y, playerNumber, game) {
    const capturedTiles = [];
    ALL_DIRECTIONS.forEach(dir => {
        const newX = x + dir.dx;
        const newY = y + dir.dy;
        if (isValidTile(newX, newY) && game.board[newX][newY] !== playerNumber) {
            if (isSurrounded(newX, newY, playerNumber, game)) {
                game.board[newX][newY] = playerNumber;
                capturedTiles.push({x: newX, y: newY});
            }
        }
    });
    return capturedTiles;
}

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.emit('receiveThemesAndEnums', {THEMES, PLAYER_NUMBER_ENUM});

    socket.on('join', (data) => {
        console.log('join:', data);
        boardOrientation = data.boardOrientation;
        const name = data.name;
        const {gameRoom, player} = addPlayerToGame(socket, name);
        if (games[gameRoom].players.length === 1) {
            games[gameRoom].boardOrientation = boardOrientation;
            games[gameRoom].board = initializeBoard(boardOrientation);
        }

        socket.emit('assignPlayer', {
            player,
            waitingForOpponent: games[gameRoom].players.length < MAX_PLAYERS_PER_GAME
        });

        io.to(gameRoom).emit('updateGame', {
            board: games[gameRoom].board,
            players: games[gameRoom].players,
            currentPlayerNumber: games[gameRoom].currentPlayerNumber,
            lastFlippedTile: games[gameRoom].lastFlippedTile,
            captureGroups: [], // Initially empty
            waitingForOpponent: games[gameRoom].players.length < MAX_PLAYERS_PER_GAME
        });

        if (games[gameRoom].players.length === MAX_PLAYERS_PER_GAME) {
            io.to(gameRoom).emit('initializeBoard', {
                board: games[gameRoom].board,
                currentPlayerNumber: games[gameRoom].currentPlayerNumber,
                players: games[gameRoom].players
            });
        }
    });

    socket.on('requestThemeChange', (data) => {
        const {playerNumber, theme} = data;
        const gameRoom = getPlayerRoom(socket.id);

        if (THEMES[theme] && gameRoom) {
            const player = games[gameRoom].players.find(p => p.playerNumber === playerNumber);
            if (player) {
                player.theme = theme;
                io.to(gameRoom).emit('themeChange', {playerNumber, players: games[gameRoom].players});
            }
        }
    });

    socket.on('disconnect', () => {
        const gameRoom = removePlayerFromGame(socket.id);
        if (gameRoom) {
            resetPlayerScores(gameRoom);
            games[gameRoom].board = initializeBoard(); // Reset the board
            games[gameRoom].currentPlayerNumber = 1; // Reset the turn to player 1
            io.to(gameRoom).emit('playerDisconnected', {
                board: games[gameRoom].board,
                players: games[gameRoom].players,
                currentPlayerNumber: games[gameRoom].currentPlayerNumber,
                waitingForOpponent: true
            });
        }
    });

    socket.on('move', async (data) => {
        const {player, selectedTiles} = data;
        const gameRoom = getPlayerRoom(player.id);
        const game = games[gameRoom];

        if (player.playerNumber === game.currentPlayerNumber) {
            const captureGroups = [];

            selectedTiles.forEach(({x, y}) => {
                if (isValidTile(x, y) && game.board[x][y] !== player.playerNumber) {
                    game.board[x][y] = player.playerNumber;
                }
            });

            captureGroups.push(selectedTiles);

            let flippedTiles = [];
            selectedTiles.forEach(({x, y}) => {
                flippedTiles.push(...captureTiles(x, y, player.playerNumber, game));
            });

            while (flippedTiles.length > 0) {
                captureGroups.push(flippedTiles);
                const newFlippedTiles = [];
                flippedTiles.forEach(tile => {
                    newFlippedTiles.push(...captureTiles(tile.x, tile.y, player.playerNumber, game));
                });
                flippedTiles = newFlippedTiles;
            }

            calculatePlayerScore([...(captureGroups.flat() || [])], player, gameRoom);
            game.lastFlippedTile = selectedTiles[selectedTiles.length - 1]; // Update the last flipped tile

            game.currentPlayerNumber = togglePlayerTurn(game);

            // Emit the updated game state immediately
            io.to(gameRoom).emit('updateGame', {
                board: game.board,
                players: game.players,
                currentPlayerNumber: game.currentPlayerNumber,
                lastFlippedTile: game.lastFlippedTile,
                captureGroups,
                waitingForOpponent: game.players.length < MAX_PLAYERS_PER_GAME
            });
        }
    });

});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
