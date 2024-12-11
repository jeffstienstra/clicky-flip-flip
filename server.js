const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));

// Constants
let BOARD_SIZE;
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
const cursorConfig = {
    standard: {
        4: ['doubleTile'],
        8: ['doubleTile', 'plus', 'T', 'L'],
        12: ['plus', 'T', 'L'],
        20: ['plus', 'T', 'L', 'LPlus', 'checker', 'line']
    },
    checkerboard: {
        4: ['singleTile'],
        8: ['doubleTile', 'plus', 'T', 'L'],
        12: ['plus', 'T', 'L'],
        20: ['plus', 'T', 'L', 'LPlus', 'checker', 'line']
    },
    islands: {
        20: ['plus', 'T', 'L', 'LPlus', 'checker', 'line']
    },
    topBottomSplit: {
        4: ['singleTile'],
        8: ['plus', 'T', 'L'],
        12: ['plus', 'T', 'L'],
        20: ['plus', 'T', 'L', 'LPlus', 'checker', 'line']
    }
};
const islandShapes = [
    [ // main island
        {dx: -2, dy: -2}, {dx: -1, dy: -2}, {dx: 0, dy: -2},
        {dx: -1, dy: -1}, {dx: 0, dy: -1}, {dx: 1, dy: -1},
        {dx: -1, dy: 0}, {dx: 0, dy: 0}, {dx: 1, dy: 0},
        {dx: -1, dy: 1}, {dx: 0, dy: 1}, {dx: 1, dy: 1},
        {dx: 0, dy: 2}, {dx: 1, dy: 2}, {dx: 2, dy: 2},
    ],
    [ // small island
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
let board;
let boardOrientation;
let winPercentage;

function buildStandardBoard(board, size) {
    for (let x = 0; x < size; x++) {
        for (let y = 0; y < size; y++) {
            board[x][y] = 0;
        }
    }
    return board;
}

function buildCheckerboardBoard(board, size, checkerSize) {
    for (let i = 0; i < size; i += checkerSize) {
        for (let j = 0; j < size; j += checkerSize) {
            const playerOwner = (i / checkerSize + j / checkerSize) % 2 === 0 ? 1 : 2;
            for (let x = i; x < i + checkerSize; x++) {
                for (let y = j; y < j + checkerSize; y++) {
                    board[x][y] = playerOwner;
                }
            }
        }
    }
    return board;
}

function initializeBoard(boardOrientation = 'standard', boardSize = 8) {
    if (!boardOrientation || !boardSize) {
        return;
    }
    BOARD_SIZE = boardSize;
    availableCursors = cursorConfig[boardOrientation][boardSize];

    board = Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(null));

    switch (boardOrientation) {
        case 'standard': // Board of neutral tiles
            buildStandardBoard(board, boardSize);
            if (boardSize === 4) {
                winPercentage = 50;
            } else if (boardSize === 8) {
                winPercentage = 35;
            } else if (boardSize === 12) {
                winPercentage = 25;
            } else if (boardSize === 20) {
                winPercentage = 10;
            }
            break;
        case 'checkerboard':
            let checkerSize = 2;
            if (boardSize === 4) { // 4x4 board, 2x2 checkerSize
                winPercentage = 83;
            }
            if (boardSize === 8) { // 8x8 board, 2x2 checkerSize
                winPercentage = 75;
            }
            if (boardSize === 12) { // 12x12 board, 3x3 checkerSize
                checkerSize = 3;
                winPercentage = 75;
            }
            else if (boardSize === 20) { // 20x20 board, 5x5 checkerSize
                checkerSize = 5;
                winPercentage = 75;
            }
            buildCheckerboardBoard(board, boardSize, checkerSize);
        break;
        case 'topBottomSplit':
            winPercentage = 75;
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
        case 'islands':
            createRandomIslands();
        break;
        default: 'standard';
        break;
    }
    board.totalTiles = BOARD_SIZE * BOARD_SIZE;
    board.winPercentage = winPercentage;

    return board;
}

function createRandomIslands() {
    // Step 1: Split the board into two halves
    winPercentage = 75;
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

function createGame(roomPassword = null) {
    const gameRoom = `game_${Object.keys(games).length + 1}`;
    games[gameRoom] = {
        board: initializeBoard(boardOrientation),
        currentPlayerNumber: 1,
        lastFlippedTile: null,
        players: [],
        boardOrientation: boardOrientation || 'standard',
        winPercentage,
        roomPassword
    };
    return gameRoom;
}

function findOrCreateGameRoom(roomPassword) {
    let gameRoom;

    if (roomPassword) {
        // Find a game room with the given password that is not full
        gameRoom = Object.keys(games).find(room => games[room].roomPassword === roomPassword && games[room].players.length < MAX_PLAYERS_PER_GAME);
        if (!gameRoom) {
            // Create a new game room with the given password
            gameRoom = createGame(roomPassword);
        }
    } else {
        // Find a game room without a password that is not full
        gameRoom = Object.keys(games).find(room => !games[room].roomPassword && games[room].players.length < MAX_PLAYERS_PER_GAME);
        if (!gameRoom) {
            // Create a new game room without a password
            gameRoom = createGame();
        }
    }

    return gameRoom;
}

function getPlayerRoom(socketId) {
    return Object.keys(games).find(room => games[room].players.some(p => p.id === socketId));
}

function addPlayerToGame(socket, name, roomPassword) {
    const gameRoom = findOrCreateGameRoom(roomPassword);
    const playerNumber = games[gameRoom].players.length + 1;
    const player = {
        id: socket.id,
        name: name,
        playerNumber,
        score: 0,
        theme: 'Forest'
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

// function calculatePlayerScoreIncrementing(flippedTiles, player, gameRoom) {
//     const playerInGame = games[gameRoom].players.find(p => p.id === player.id);
//     // constant increase in score - 1 point per tile flipped
//     if (playerInGame) {
//         playerInGame.score += flippedTiles.length;
//     }
// }

function calculatePlayerScorePercentage(gameRoom) {
    const totalTiles = games[gameRoom].board.totalTiles;
    let player1Tiles = 0;
    let player2Tiles = 0;
    games[gameRoom].board.forEach(row => {
        row.forEach(tile => {
            if (tile === 1) {
                player1Tiles++;
            } else if (tile === 2) {
                player2Tiles++;
            }
        });
    });
    // Calculate the percentage of tiles owned by each player and round to the nearest whole number
    const player1Percentage = Math.round((player1Tiles / totalTiles) * 100);
    const player2Percentage = Math.round((player2Tiles / totalTiles) * 100);
    if (games[gameRoom].players[0]) {
        games[gameRoom].players[0].score = player1Percentage;
    }
    if (games[gameRoom].players[1]) {
        games[gameRoom].players[1].score = player2Percentage;
    }
}

function checkIfGameOver(gameRoom) {
    const game = games[gameRoom];
    const player1Percentage = game.players[0].score;
    const player2Percentage = game.players[1].score;
    if (player1Percentage >= winPercentage || player2Percentage >= winPercentage) {
        io.to(gameRoom).emit('gameOver', {
            winner: player1Percentage > player2Percentage ? 1 : 2,
            players: game.players
        });
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
        const {name, roomPassword, boardOrientation, boardSize} = data;
        const {gameRoom, player} = addPlayerToGame(socket, name, roomPassword);

        if (games[gameRoom].players.length === 1) {
            games[gameRoom].boardOrientation = boardOrientation;
            games[gameRoom].board = initializeBoard(boardOrientation, parseInt(boardSize));
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
            captureGroups: [],
            waitingForOpponent: games[gameRoom].players.length < MAX_PLAYERS_PER_GAME,
            winPercentage
        });

        calculatePlayerScorePercentage(gameRoom);

        if (games[gameRoom].players.length === MAX_PLAYERS_PER_GAME) {
            io.to(gameRoom).emit('initializeBoard', {
                board: games[gameRoom].board,
                availableCursors,
                currentPlayerNumber: games[gameRoom].currentPlayerNumber,
                players: games[gameRoom].players,
                winPercentage: winPercentage
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
            const hasPassword = !!games[gameRoom].roomPassword;
            io.to(gameRoom).emit('playerDisconnected', {hasPassword});
                // board: games[gameRoom].board,
                // players: games[gameRoom].players,
                // currentPlayerNumber: games[gameRoom].currentPlayerNumber,
                // waitingForOpponent: true
            // });
        }
    });

    socket.on('tileHover', (data) => {
        const gameRoom = getPlayerRoom(socket.id);
        const playerId = socket.id;
        io.to(gameRoom).emit('tileHover', {...data, playerId});
    });

    socket.on('tileHoverOut', () => {
        const gameRoom = getPlayerRoom(socket.id);
        const playerId = socket.id;
        io.to(gameRoom).emit('tileHoverOut', {playerId});
    });

    socket.on('move', async (data) => {
        const {player, selectedTiles, clickedTile} = data;
        const gameRoom = getPlayerRoom(player.id);
        const game = games[gameRoom];

        if (player?.playerNumber === game?.currentPlayerNumber) {
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

            // calculatePlayerScoreIncrementing([...(captureGroups.flat() || [])], player, gameRoom);
            calculatePlayerScorePercentage(gameRoom);
            game.lastFlippedTile = clickedTile;

            game.currentPlayerNumber = togglePlayerTurn(game);

            io.to(gameRoom).emit('updateGame', {
                board: game.board,
                players: game.players,
                currentPlayerNumber: game.currentPlayerNumber,
                lastFlippedTile: game.lastFlippedTile,
                captureGroups,
                waitingForOpponent: game.players.length < MAX_PLAYERS_PER_GAME,
                winPercentage
            });
        }
        checkIfGameOver(gameRoom);
    });

});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
