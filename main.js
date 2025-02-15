// Copyright (c) 2025 Shane Harwood
// All rights reserved.
// Portions of this code are based on the original work by Alex Davison
// Original repository: https://github.com/qiuzhu0/chessdb-mobile
//
// Specific code attributed by comments in the code
// 

import { Frontier } from './Frontier_min.js';
//stockfish-worker.js

$(() => {
    const $statusOpening = $("#status-opening");
    const hardGambitFilter = 125;

    let apiKey = null;

    // Check for API key in local storage
    apiKey = localStorage.getItem('apiKey');
    if (!apiKey) {
        promptForApiKey();
    }

    function promptForApiKey() {
        const userApiKey = prompt("Please enter your API key:");
        if (userApiKey) {
            apiKey = userApiKey;
            localStorage.setItem('apiKey', apiKey);
        } else {
            alert("API key is required to use this application.");
        }
    }

    function handleExpiredApiKey() {
        const userApiKey = prompt("Your API key has expired. Please enter a new API key or contact bodhisattv to refresh your key:");
        if (userApiKey) {
            apiKey = userApiKey;
            localStorage.setItem('apiKey', apiKey);
        } else {
            alert("API key is required to use this application.");
        }
    }

    const fenQueue = []; // FIFO/LIFO queue

    let apiCalls = 0; 
    
    function clearArrows() {
        const arrowLayer = document.getElementById('arrow-layer');
        arrowLayer.innerHTML = ''; // Clear all arrows
    }

    function drawArrow(from, to, isResponse, options = {}) {
        // console.log("draw arrow", from, to, isResponse, options);
        const arrowLayer = document.getElementById('arrow-layer');
        const cb = document.getElementById('board');
        const boardRect = cb.getBoundingClientRect();
        const squareSize = (boardRect.width - 0) / 8;
    
        // Account for board orientation
        const orientation = board.orientation() === 'white' ? 1 : -1;
        //console.warn("trying to draw arrow", from, to, options);
    
        const getSquareCenter = (square) => {
            const file = square.charCodeAt(0) - 'a'.charCodeAt(0);
            const rank = 8 - parseInt(square[1], 10);
            return [
                boardRect.left + (orientation > 0 ? file : 7 - file) * squareSize + squareSize / 2,
                boardRect.top + (orientation > 0 ? rank : 7 - rank) * squareSize + squareSize / 2,
            ];
        };
    
        const getCircleBoundaryPoint = (centerX, centerY, targetX, targetY, radius) => {
            const angle = Math.atan2(targetY - centerY, targetX - centerX);
            return [
                centerX + radius * Math.cos(angle),
                centerY + radius * Math.sin(angle),
            ];
        };
    
        const [startX, startY] = getSquareCenter(from);
        const [endX, endY] = getSquareCenter(to);
    
        const { color = 'rgba(255, 0, 0, 0.7)', thickness = 8, opacity = 0.8 } = options;
    
        // Circle radius reduced for shorter line and head overlap
        const radius = squareSize / 3; // - thickness / 2;
    
        const [adjustedStartX, adjustedStartY] = getCircleBoundaryPoint(startX, startY, endX, endY, radius);
        const [adjustedEndX, adjustedEndY] = getCircleBoundaryPoint(endX, endY, startX, startY, radius); // Shortened for arrowhead
        const [headEndX, headEndY] = getCircleBoundaryPoint(endX, endY, startX, startY, radius * 0.25); // Shortened for arrowhead
    
        // Create the arrow line
        const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        arrow.setAttribute('x1', adjustedStartX);
        arrow.setAttribute('y1', adjustedStartY);
        arrow.setAttribute('x2', adjustedEndX);
        arrow.setAttribute('y2', adjustedEndY);
        arrow.setAttribute('stroke', color);
        arrow.setAttribute('stroke-width', thickness);
        arrow.setAttribute('opacity', opacity);
        arrow.setAttribute('stroke-linecap', 'round'); // Rounded edges
        arrowLayer.appendChild(arrow);
    
        // Draw the arrowhead
        drawArrowhead(headEndX, headEndY, endX - startX, endY - startY, thickness, color, opacity, isResponse);
    }
    
    function drawArrowhead(x, y, dx, dy, thickness, color, opacity, isResponse) {
        // console.log("draw arrowhead", x, y, dx, dy, thickness, color, opacity, isResponse);
        if (isResponse) return; // Skip drawing arrowhead for responses
        // if (isResponse) thickness /=1.5; // Skip drawing arrowhead for responses
        const arrowLayer = document.getElementById('arrow-layer');
        const angle = Math.atan2(dy, dx);
        const size = thickness * 3; // Arrowhead size
        const baseAngle = 2*Math.PI / 9; // 80° total = 40° on each side
    
        // Calculate triangle points
        const tip = [x, y];
        const left = [
            x - size * Math.cos(angle - baseAngle),
            y - size * Math.sin(angle - baseAngle),
        ];
        const right = [
            x - size * Math.cos(angle + baseAngle),
            y - size * Math.sin(angle + baseAngle),
        ];
    
        // Draw the arrowhead as a filled triangle
        const arrowhead = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        arrowhead.setAttribute('points', `${tip[0]},${tip[1]} ${left[0]},${left[1]} ${right[0]},${right[1]}`);
        arrowhead.setAttribute('fill', color);
        arrowhead.setAttribute('opacity', opacity);
        arrowLayer.appendChild(arrowhead);
    }
    
    window.addEventListener('resize', onBoardUpdate);
    
    // Optional: Add an arrowhead marker definition to the SVG
    const arrowLayer = document.getElementById('arrow-layer');
    arrowLayer.innerHTML = `
        <defs>
            <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
                <polygon points="0 0, 10 3.5, 0 7" fill="red" />
            </marker>
        </defs>
    `;
    

    function addToQueue(fen, depth, priority)
    {
        //console.log(fen, depth, priority);
        if(fen === null) console.error("Null Fen added to queue");
        fenQueue.push({fen, depth, priority});
    }
    let isProcessing = false; // Prevent concurrent processing

    setInterval(async () => {
        await processQueue(); // Function to process the queue
    }, 200); // 10000 ms = 5 seconds

    const graph = new Map(); // Memoization cache for API responses
    
    const CACHE_EXPIRY = 7*24 * 60 * 60 * 1000; // 7days *24 hours in milliseconds
    
    const pweCache = new Map(); // Cache object for storing PWE data

    const CACHE_KEY = 'pweCache';
    let saveCounter = 0;

    function saveCache() {
        const cacheArray = Array.from(pweCache.entries()).map(([key, value]) => {
            return {
                key,
                value: {
                    node: value.node,
                    timestamp: value.timestamp
                }
            };
        });

        const cacheString = JSON.stringify(cacheArray);
        localStorage.setItem(CACHE_KEY, cacheString);
        console.warn(`Cache saved. Size: ${cacheString.length} bytes`);

        if (cacheString.length > 2 * 1024 * 1024) { // 3 MB
            pruneCache();
        }
    }

    function loadCache() {
        const cacheString = localStorage.getItem(CACHE_KEY);
        const size = cacheString.length;
        console.warn(`Cache Loaded. Size: ${size} bytes`);
        if (cacheString) {
            const cacheArray = JSON.parse(cacheString);
            cacheArray.forEach(({ key, value }) => {
                pweCache.set(key, value);
            });
            console.log(`Cache loaded. Size: ${cacheArray.length} entries`);
        }
        if (cacheString.length > 2 * 1024 * 1024) { // 3 MB
            pruneCache();
        }
        updateUI();
    }

    function pruneCache() {
        const sortedEntries = Array.from(pweCache.entries()).sort((a, b) => a[1].timestamp - b[1].timestamp);
        const pruneCount = Math.ceil(sortedEntries.length * 0.1);
        for (let i = 0; i < pruneCount; i++) {
            pweCache.delete(sortedEntries[i][0]);
        }
        console.log(`Cache pruned. Removed ${pruneCount} oldest entries`);
        saveCache();
        updateUI();
    }

    function saveCacheIfNeeded() {
        saveCounter++;
        if (saveCounter >= 100) {
            saveCache();
            saveCounter = 0;
        }
    }

    window.addEventListener('beforeunload', saveCache);

    // Load cache on startup
    loadCache();
    
    function getFromGraph(fen) {
        const data = pweCache.get(fen);
        if (data) {
            const age = Date.now() - data.timestamp;
            if (age < CACHE_EXPIRY) {
                //console.log("hit PWE request", fen, index, data.pwe);
                return data.node; // Return cached data if not expired
            }
        }
        //console.log("miss PWE request", fen, index);
        return null; // Data is either missing or expired
    }

    function saveToGraph(fen, node) {
        if(node[0].move === 'unkn') { 
            console.warn("refusing to save failed chessdb data", node, fen);
            return;
        }
        pweCache.set(fen,  {
            node: node,
            timestamp: Date.now()
        });
        saveCacheIfNeeded();
        // pweCache[{fenRate,index}] = {
        //     pwe: pwe,
        //     timestamp: Date.now()
        // };
    }
    
    //place holders.  Proxy dbase is fixed to 1800 for now
    let selectedTimeControls = ["blitz", "rapid", "classical"]; // Default time controls
    let selectedRatings = [1800, 2000 ,2200 ,2500]; // Default ratings

    // Initialize buttons based on default state
    function initializeToggleButtons() {
        $(".toggle-button").each(function () {
            const $button = $(this);
            const type = $button.data("type");
            const value = $button.data("value");

            if (
                (type === "time" && selectedTimeControls.includes(value)) ||
                (type === "rating" && selectedRatings.includes(value))
            ) {
                $button.addClass("active"); // Mark as active if it's part of the default state
            } else {
                $button.removeClass("active"); // Ensure others are not active
            }
        });
    }

    // Handle button clicks
    $(document).on("click", ".toggle-button", function () {
        const $button = $(this);
        const type = $button.data("type");
        const value = $button.data("value");

        $button.toggleClass("active");

        if (type === "time") {
            // Update selected time controls
            if ($button.hasClass("active")) {
                selectedTimeControls.push(value);
            } else {
                selectedTimeControls = selectedTimeControls.filter(tc => tc !== value);
            }
        } else if (type === "rating") {
            // Update selected ratings
            if ($button.hasClass("active")) {
                selectedRatings.push(value);
            } else {
                selectedRatings = selectedRatings.filter(r => r !== value);
            }
        }

        console.log("Selected Time Controls:", selectedTimeControls);
        console.log("Selected Ratings:", selectedRatings);

        onBoardUpdate(); // Refresh data based on new filters
    });

    // Run initialization on page load
    $(document).ready(() => {
        initializeToggleButtons();
    });
    
    function updateSortingBoxes() {
    const turn = game.turn();

    const isFlipped = board.orientation() === 'black';
    const opponent = (isFlipped && turn === 'w') || (!isFlipped && turn === 'b');
        
    const opponentBox = document.getElementById('opponent-box');
    const playerBox = document.getElementById('player-box');

    if (!opponent) {
        opponentBox.style.display = 'none';
        playerBox.style.display = 'flex';
    } else {
        opponentBox.style.display = 'flex';
        playerBox.style.display = 'none';
    }
    }

    async function fetchCombinedProxyData(fen, priority = 1) {
        const timeout = 15000;
        const controller = new AbortController();
        const signal = controller.signal;
    
        // Set a timeout to abort the fetch
        const timeoutId = setTimeout(() => {
            controller.abort();
        }, timeout);
    
        try {
            let url = `https://34.31.72.37:3003/fen?fen=${encodeURIComponent(fen)}&apiKey=${apiKey}&priority=${priority}`;
            const response = await fetch(url, { signal });
    
            if (!response.ok) {
                if (response.status === 403) {
                    const errorData = await response.json();
                    if (errorData.error === 'Invalid API key') {
                        alert("Invalid API key. Please enter a valid API key.");
                        promptForApiKey();
                    } else if (errorData.error === 'API key has no remaining requests') {
                        handleExpiredApiKey();
                    }
                }
                console.error('Error fetching data:', response.statusText);
                return null;
            }
    
            return await response.json();
        } catch (error) {
            if (error.name === 'AbortError') {
                console.error('Fetch aborted due to timeout');
            } else {
                console.error('Error fetching data:', error);
            }
            return null;
        } finally {
            // Clear the timeout once the fetch completes or fails
            clearTimeout(timeoutId);
        }
    }

    // Function to update the Cache and Queue Stats
    function updateUI() {
        document.getElementById("queue-size").textContent = fenQueue.length;
        document.getElementById("graph-size").textContent = pweCache.size;
    }

    function highlightLastMove() {
        // Remove any existing highlights
        $("#board .square-55d63").removeClass("last-move");

        // Get the last move
        const moves = game.history({ verbose: true });
        if (moves.length > 0) {
            const lastMove = moves[moves.length - 1];
            const fromSquare = `square-${lastMove.from}`;
            const toSquare = `square-${lastMove.to}`;

            // Highlight the squares involved in the last move
            $(`#board .${fromSquare}`).addClass("last-move");
            $(`#board .${toSquare}`).addClass("last-move");

            // console.log("Last Move: ", lastMove);
        }

    }

    function chessSound() { //check last move.  Play a move of capture sound if appropriate
        const moves = game.history({ verbose: true });
        if (moves.length > 0) {
            const lastMove = moves[moves.length - 1];
            //if lastmove.san contains an x, it was a capture
            const wasCapture = lastMove.san.includes("x");

            if(wasCapture) {
                new Audio('https://github.com/lichess-org/lila/blob/master/public/sound/standard/Capture.mp3?raw=true').play();
            } else {
                new Audio('https://github.com/lichess-org/lila/blob/master/public/sound/standard/Move.mp3?raw=true').play();
            }
        }
    }

    async function establishNode(fen, backupOpeningName, priority = 1.2, cacheOnly = false)
    {
        //console.log("test generateMovesFromFEN ", generateMovesFromFEN(fen));
        let madeAPIcall = false;
        if(!fen) {
            console.error("Null Fen passed to establishNode");
            return;
        }

        const timeControls = selectedTimeControls.join(",");
        const ratings = selectedRatings.join(",");

        //response = getFromCache(`${fen}-${ratings}-${timeControls}`);
        let response = getFromGraph(`${fen}-${ratings}-${timeControls}`);
        
        if(response){
            if(!response.total) {//missing total data ignore
                console.warn("missing total data ignore", response);
                response = null;
            }
        } else if(cacheOnly) { //if no cache exists, queue it but return null for now.  processQueue will reupdate board when done 
            //console.log("Cache Miss ", fen);
            addToQueue(fen, 1, priority);
            processQueue();
            madeAPIcall = true;
            return {response, madeAPIcall};
        }

        while(!response){ //new node
            //console.log("New Request ", fen);
            response = await fetchCombinedProxyData(fen, priority);
            madeAPIcall = true;
        }

        //console.log("Clean complete ");
        if(isNaN(response.total))
        {
            console.warn("NaN total Not Saving",response.total, response);

            console.warn("clearing any stale elements in graph that might be the problem");
            graph.delete(`${fen}-${ratings}-${timeControls}`);
        }  else {
            if(response.opening === "" || response.opening === undefined) 
            {
                //console.warn("attempt to add opening name", response.opening, "backup", backupOpeningName);
                response.opening=backupOpeningName;
            }
            saveToGraph(`${fen}-${ratings}-${timeControls}`,response);
            //console.log("Caching Graph ", fen, response);
        }
        
        return {response, madeAPIcall};
    }

    // Function to process the queue
    async function processQueue() {
        //console.log("process queue")
        if (isProcessing || isUpdatingBoard || fenQueue.length === 0) return; // No items to process

        isProcessing = true;
        //flop =1;
        while (fenQueue.length > 0) {// || bestQueue.length > 0) {
            let {fen, depth, backupName} = fenQueue.pop();

            const timeControls = selectedTimeControls.join(",");
            const ratings = selectedRatings.join(",");

            
            let cachedData = getFromGraph(`${fen}-${ratings}-${timeControls}`);
            if(cachedData) if(!cachedData.total) {
                console.warn("Cached with missing data, ignore");
                cachedData = null;
            }

            //check if we've already cached it
            if( (depth >0) || !cachedData){
                try {
                    //console.log(`Processing FEN: `, fen);
                    let {response, madeAPIcall} = await establishNode(fen,backupName,1.2); //, depth); // API call
                    //console.log(`made API calls`, madeAPIcall, `Resulting Query: `, response);
                    if(madeAPIcall) 
                    {
                        apiCalls++;
                        await new Promise((resolve) => setTimeout(resolve, 300)); // 1-second delay
                    }
                    // isProcessing = false;
                    // return;
                } catch (error) {
                    console.error(`Error processing FEN: ${fen}`, error);
                }
                //updateUI(); // Update the UI after processing
            } //console.log("redundant queue element skipping", fen);
            updateUI(); // Update the UI after processing
        }
        isProcessing = false;
        console.log("Queue Empty");
        onBoardUpdate();
    }

    let lastHash = null; //last board where arrows were drawn

    async function onBoardUpdate() {
        console.log("API calls this session ", apiCalls);
        // console.log("Testing convertEval: ", convertEval(0, "b")); // Should not throw an error

        if (isUpdatingBoard) {
            return;
        }

        isUpdatingBoard = true;

        //half queue, to not slow the user
        fenQueue.length = Math.ceil(fenQueue.length*0.9);
        //console.log("Clear Queue");

        updateSortingBoxes();

        try {
            highlightLastMove();

            //set analysis link
            $lichess.attr("href", `https://lichess.org/analysis/fromPosition/${game.fen()}`);
            
            const fen = game.fen(); // Current FEN for caching

            //hash fen and board orientation
            let hash = fen + board.orientation();

            if(hash != lastHash) clearArrows();
            lastHash = hash;

            let {response, madeAPIcall} = await establishNode(fen, "", 1, true); //, 2); //
            if(madeAPIcall) apiCalls++;
            
            //console.log("Poll clean data, ", madeAPIcall, response);

            let queryInfo = response;

            //wait 100 ms
            await new Promise((resolve) => setTimeout(resolve, 200)); // 0.2-second delay
          
            if( !queryInfo ) {  //if clean data can't be found, don't break anything
                console.warn("queryInfo empty", fen);

                //clear text output
                $("#pgn-display").text("Processing...");
                $queryOutput.text("");
                $queryOutput.append("<p>Processing position.  Please wait, </p>");
                $queryOutput.append("<p>Or, explore other sidelines while I evaluate this position</p>");
                $queryOutput.append("<p>Keyboard Shortcuts: <--, -->, F-flip </p>");
                
                sortedQueryInfo = null;

                isUpdatingBoard = false;
                return;
            }

            let frontier = await investigateFrontier(queryInfo, fen, 0.01, 0.99);

            //if frontier coloredElements is defined, draw them
            if(frontier.coloredElements) drawColoredFrontier(frontier);
            // investigateScore(queryInfo, fen);

            //if queue is empty, assume solution found, start pre-calcing elements of the frontier
            if(fenQueue.length === 0) {
                console.log("Queue Empty, start pre-calculation", frontier.elements);
                for( const element of frontier.coloredElements) investigateFrontier(element.data.node, element.data.fen, 0.01, 0.99, 0.44);
            }

            $("#pgn-display").text(game.pgn()); // Update PGN display
            updateUIWithSortingState(queryInfo, frontier.ranges);
            
            // outputFrontier(queryInfo, frontier);
        } finally {
            isUpdatingBoard = false;
        }

        //processQueue();
    }

    function drawColoredFrontier(frontier) {
        const arrowQueue = [];
    
        // console.log("coloredElements", frontier.coloredElements);
        for (const coloredElement of frontier.coloredElements) {
    
            const blendedColor = coloredElement.color;
    
            // console.log("Drawing Arrow", coloredElement);
            // console.log("ColorElement.data", coloredElement.data.node); 
            queueMove(coloredElement.data.move, coloredElement.data.node, blendedColor, arrowQueue);
        }
        drawQueue(arrowQueue);
    }
    
    function queueArrow(from, to, color, thickness, opacity, isResponse, arrowQueue) {
        // console.log("queueArrow", from, to, color, thickness, opacity, isResponse);
        arrowQueue.push({ from, to, color, thickness: Number(thickness), opacity: Number(opacity), isResponse:isResponse });  
        // console.log("arrowQueue", arrowQueue); 
    }
    
    function drawQueue(arrowQueue) {
        // Partition arrows by "from"
        const partitionedArrows = arrowQueue.reduce((acc, arrow) => {
            if (!acc[arrow.from]) {
                acc[arrow.from] = [];
            }
            acc[arrow.from].push(arrow);
            return acc;
        }, {});

        // Adjust thickness within each subset
        Object.values(partitionedArrows).forEach(subset => {
            // Sort subset by thickness
            subset.sort((a, b) => b.thickness - a.thickness);

            // Increase thickness of the first arrow by 10%
            const adj = 0.2;
            subset[0].thickness *= 1 + adj;
            subset[subset.length-1].thickness *= 1- adj;
            

            // Adjust thickness of subsequent arrows
            for (let i = 1; i < subset.length-1; i++) {
                const prevThickness = subset[i - 1].thickness;
                const nextThickness = i + 1 < subset.length ? subset[i + 1].thickness : subset[i].thickness;
                subset[i].thickness = subset[i].thickness * (1-adj) + (prevThickness + nextThickness) / 2 * (adj);
            }
        });

        // Flatten the partitioned arrows back into a single array
        const adjustedArrows = Object.values(partitionedArrows).flat();

        // Sort and draw the adjusted arrows
        adjustedArrows.sort((a, b) => b.thickness - a.thickness);
        adjustedArrows.forEach(arrow => {
            drawArrow(arrow.from, arrow.to, arrow.isResponse, { color: arrow.color, thickness: arrow.thickness, opacity: arrow.opacity });
        });
    }    

    function queueMove(move, node, color, arrowQueue, threshold = 0.04) {

        const from = move.substring(0, 2); const to = move.substring(2, 4);
        
        //pull row as number of 2nd char from from and to
        const rowF = from.charCodeAt(1) - 49;
        const rowT = to.charCodeAt(1) - 49;

        const scale = 7-Math.abs(rowF - rowT);

        queueArrow(from, to, color, 12-scale/1000, 1, false, arrowQueue);
    
        if(!node) { 
            console.log("node is null no response arrows");
            return;
        }
        let mostPopular = 0;

        let moveArray = Object.values(node); //.filter(item => typeof item === 'object' && item.move);
        // console.log("moveArray ", moveArray);
        for(let i = 0; i < Object.values(moveArray[0]).length; i++) {
            const move2 = moveArray[i];
            // console.log("move2 ", move2);
            
            //if move2 undefined, ignore
            if(!move2) continue;

        // moveArray.forEach(move2 => {
            if (move2.total > mostPopular) mostPopular = move2.total;
        }
        mostPopular /= node.total;
    
        for(let i = 0; i < Object.values(moveArray[0]).length; i++) {
            const move2 = moveArray[i];
            //if move2 undefined, ignore
            if(!move2) continue;
        // moveArray.forEach(move2 => {
            if (move2.total / node.total >= threshold) {
                queueArrow(
                    move2.move.substring(0, 2),
                    move2.move.substring(2, 4),
                    color,
                    27 * Math.pow(move2.total / node.total, 0.5), // / Math.pow(mostPopular, 0.5), 
                    1,
                    true,
                    arrowQueue
                );
            }
        }
    }    

    async function investigateFrontier(grandpa, boardState, minAggression, maxAggression, width = 0.7, minPopularity = 0.004)
    {
        const timeControls = selectedTimeControls.join(",");
        const ratings = selectedRatings.join(",");
        
        //find best frontier
        let frontier = new Frontier(minAggression,maxAggression);
        //console.log("New Frontier initialized:", frontier);
    
        // Map sorting criteria to variables
        const criteriaMap = {
            tricky: 'pwe',
            WRtimid: 'winSwing',
            forceful: 'lazy',
            patient: 'notLazy',
            WR: 'winrate',
            popWR: 'signedWWR',
            noBias: 'score',
            popularity: 'total'
        };

        const turn = getTurnFromFEN(boardState);

        const grandpaMoves = Object.values(grandpa).filter(item => typeof item === 'object' && item.move);
        // console.log("grandpa ", grandpa);
        const isFlipped = board.orientation() === 'black';
        let criteria = sortingState.player;

        const opponent = (isFlipped && turn === 'w') || (!isFlipped && turn === 'b');
        if(opponent) criteria = sortingState.opponent;

        for(let i = 0; i < grandpaMoves.length; i++) {
            const parentMove = grandpa[i];

            // console.log("parentMove ", parentMove, parentMove.total, grandpa.total);
        // grandpa.forEach(parentMove => {
            if(parentMove.total/grandpa.total >= minPopularity && (grandpa[0].score - parentMove.score < hardGambitFilter)) { //only consider moves over minPopularity and hardGambitFilter
                let parentFen = fenAfterMove(boardState, parentMove.moveSan);
                let parent = getFromGraph(`${parentFen}-${ratings}-${timeControls}`);
                let move = parentMove.move;

                //based on turn and orientation, determine which sorting criteria to use
                let red = criteriaMap[criteria.red];
                let redValue = parentMove[red];
                if (red === 'pwe' || red === 'winSwing' || red === 'lazy' || red === 'signedWWR' || red === 'winrate' ) {
                    redValue = convertScore(redValue, turn);
                } else if (red === 'notLazy') {
                    redValue = 1.25 * parentMove.score - 0.25 * convertScore(parentMove.lazy,turn);
                }

                let green = criteriaMap[criteria.green];
                let greenValue = parentMove[green];
                if (green === 'pwe' || green === 'winSwing' || green === 'lazy' || green === 'signedWWR' || green === 'winrate' ) {
                    greenValue = convertScore(greenValue, turn);
                } else if (green === 'notLazy') {
                    greenValue = 1.25 * parentMove.score- 0.25 * convertScore(parentMove.lazy,turn);
                }
                

                let blue = criteriaMap[criteria.blue];
                let blueValue = parentMove[blue];
                if (blue === 'pwe' || blue === 'winSwing' || blue === 'lazy' || blue === 'signedWWR' || blue === 'winrate' ) {
                    blueValue = convertScore(blueValue, turn);
                } else if (blue === 'notLazy') {
                    blueValue = 1.25 * parentMove.score - 0.25 * convertScore(parentMove.lazy,turn);
                }
                
                let point = [   redValue, greenValue, blueValue, parentMove.score];

                if(green != 'signedWWR') [point.push(convertScore(parentMove.signedWWR, turn))];
                if(green != 'winSwing') [point.push(convertScore(parentMove.winSwing, turn))];
                if(red != 'pwe') [point.push(convertScore(parentMove.pwe, turn))];
                if(blue != 'lazy') [point.push(convertScore(parentMove.lazy,turn))];
                if(blue != 'notLazy') [point.push(1.25 * parentMove.score- 0.25 * convertScore(parentMove.lazy,turn))];
                
                //only on opponents turn
                if(red != 'winrate' && opponent) [point.push(convertScore(parentMove.winrate, turn))];
                if(red != 'popularity' && opponent) [point.push(parentMove.total/grandpa.total)];

                frontier.addElement(point, {move:move, moveSan:parentMove.moveSan, fen:parentFen, node:parent});
            }
        }

        //we should have our frontier now   
        if(frontier.elements.length > 0) {
            try{
            frontier.filterElements();
            } catch (error) {
                console.error("Error filtering frontier elements", error);
            } 
        
        }
        
        if(frontier.coloredElements) {
            // console.log("frontier coloredElements", frontier.coloredElements);
            for (let i = 0; i < frontier.coloredElements.length; i++) {
                // console.log("frontier coloredElement[i]", frontier.coloredElements[i]);
                //console.log("frontierElement ", frontierElement)
                
                if(frontier.coloredElements[i].data.node === null) {
                    let suggestedOpeningName = grandpa.opening;

                    //if grandpa opening is undefined, don't add it to the suggested opening name
                    if(suggestedOpeningName === undefined) suggestedOpeningName = "";
                    if(suggestedOpeningName === null) suggestedOpeningName = "";

                    suggestedOpeningName = suggestedOpeningName + " " + frontier.coloredElements[i].data.moveSan;
                
                    // const result = await establishNode(frontier.coloredElements[i].data.fen, frontier.coloredElements[i].data.moveSan);
                    // frontier.coloredElements[i].data.node = result.response;
                    addToQueue(frontier.coloredElements[i].data.fen, 1, suggestedOpeningName);
                }
                    // unexplored.set(frontier.coloredElements[i].data.fen, frontier.coloredElements[i].data.score);
                // for (const frontierElement of frontier.elements) {
                // let frontierParent = frontier.coloredElements[i].data.node;
                //console.log("frontier Parent", grandpa.opening, frontierElement.moveSan, "string check", grandpa.opening + " " + frontierElement.moveSan);
            
                // //console.log("frontierElement ", frontierElement)
                // let suggestedOpeningName;
                // if (grandpa.opening === "") suggestedOpeningName = ""; 
                // else suggestedOpeningName = grandpa.opening + " " + frontier.coloredElements[i].data.moveSan;
            
                // const response = await establishNode(frontier.coloredElements[i].data.fen, suggestedOpeningName); // Await works here
                // const frontierParent = response.response;
                
                // frontier.coloredElements[i].data.node = frontierParent;

            }
        }       

        return frontier;
    }

    function distribution(value, range) {
        if(value <= range.min) return 0;
        const result = Math.pow((value - range.min) / (range.max - range.min), Math.log(0.5)/Math.log((range.avg - range.min) / (range.max - range.min)));

        // console.log("range", range, "value", value, result);
        
        return result;
    }

    function colorOfPoint(point, ranges, minIntensity = 25) {
        if(!ranges) return "rgb(204,204,204)";
        // console.log("colorOfPoint", point, ranges);
        const color = [0, 1, 2].map((d, j) => {
            const range = ranges[j];
            const value = point[d];
            if(range.min === range.max) return 204; // 80% of 255
            return Math.round(minIntensity + (255-minIntensity) * distribution(value, range));
        });
        // console.log("colorOfPoint", point, color);
        return `rgb(${color.join(",")})`;
    }

    function updateUIWithSortingState(queryInfo, ranges) {
        $queryOutput.text("");
        // console.log("Outputing ", queryInfo);
        $statusDisplay.text(isNaN(queryInfo.winrate) ? "50.00" : `${queryInfo.winrate.toFixed(1)}%, ${formatNumber(queryInfo.total)}`);
        $statusOpening.text(`${queryInfo.opening}`);

        // Map sorting criteria to variables
        const criteriaMap = {
            tricky: 'pwe',
            WRtimid: 'winSwing',
            forceful: 'lazy',
            patient: 'notLazy',
            WR: 'winrate',
            popWR: 'signedWWR',
            noBias: 'score',
            popularity: 'total'
        };

        // Determine sorting criteria for player and opponent
        const playerCriteria = sortingState.player[sortingState.lastEdited.player];
        const opponentCriteria = sortingState.opponent[sortingState.lastEdited.opponent];

        // Sort queryInfo based on the selected criteria
        sortedQueryInfo = Object.values(queryInfo).filter(item => typeof item === 'object' && item.move);
        sortedQueryInfo.sort((a, b) => {
            let aComparisonValue;
            let bComparisonValue;

            const turn = game.turn();
            const isFlipped = board.orientation() === 'black';
            // if((isFlipped && turn === 'w') || (!isFlipped && turn === 'b')) criteria = sortingState.opponent;

            // const criteria = turn === "w" ? playerCriteria : opponentCriteria;
            const criteria = ((isFlipped && turn === 'w') || (!isFlipped && turn === 'b')) ? opponentCriteria : playerCriteria;
            const variable = criteriaMap[criteria];

            if (variable === 'pwe' || variable === 'winSwing' || variable === 'lazy' || variable === 'signedWWR' || variable === 'winrate' ) {
                aComparisonValue = convertScore(a[variable], turn);
                bComparisonValue = convertScore(b[variable], turn);
            } else if (variable === 'notLazy') {
                aComparisonValue = a.score * (1 + 0.25) - 0.25 * convertScore(a.lazy, turn);
                bComparisonValue = b.score * (1 + 0.25) - 0.25 * convertScore(b.lazy, turn);
            } else {
                aComparisonValue = a[variable];
                bComparisonValue = b[variable];
            }

            if (isNaN(aComparisonValue) && isNaN(bComparisonValue)) return 1;
            if (isNaN(aComparisonValue)) return 1;
            if (isNaN(bComparisonValue)) return -1;
            if (aComparisonValue === bComparisonValue) return b.total - a.total;
            if (turn === "b" && criteria === 'winrate') return aComparisonValue - bComparisonValue;
            return bComparisonValue - aComparisonValue;
        });

        // Output sorted queryInfo
        for (let i = 0; i < sortedQueryInfo.length; i++) {
            if (sortedQueryInfo[i].moveSan === undefined) continue;
            if (sortedQueryInfo[i].total / queryInfo.total < 0.004) continue; // Skip moves with less than 0.4% popularity

            let nextPWE = sortedQueryInfo[i].pwe;
            let nextTimid = sortedQueryInfo[i].winSwing;
            let timidDisplay = "";

            if (sortedQueryInfo[i].winrate - queryInfo.winrate >= 0) timidDisplay += "+";
            timidDisplay += (sortedQueryInfo[i].signedWWR).toFixed(1);
            timidDisplay += "% " + (sortedQueryInfo[i].winSwing).toFixed(1) + "%";
            timidDisplay += " L " + (sortedQueryInfo[i].lazy).toFixed(2);

            const popularity = sortedQueryInfo[i].total / queryInfo.mostPopSize;
            const aggression = convertScore(nextPWE, game.turn());
            let safety = sortedQueryInfo[i].score;
            if (nextTimid != null) safety = convertScore(nextTimid, game.turn());

            // let red = criteriaMap[criteria.red];
            //     let redValue = parentMove[red];
            //     if (red === 'pwe' || red === 'winSwing' || red === 'lazy' || red === 'signedWWR' || red === 'winrate' ) {
            //         redValue = convertScore(redValue, turn);
            //     } else if (red === 'notLazy') {
            //         redValue = 1.25 * parentMove.score - 0.25 * convertScore(parentMove.lazy,turn);
            //     }
            
            // const point = [aggression, convertScore(sortedQueryInfo[i].winSwing, game.turn()), convertScore(sortedQueryInfo[i].lazy, game.turn())];
            const point = [aggression, convertScore(sortedQueryInfo[i].winSwing, game.turn()), convertScore(sortedQueryInfo[i].lazy, game.turn())];
            const blendedColor = colorOfPoint(point, ranges);

            let populationOut = (100 * sortedQueryInfo[i].total / queryInfo.total).toFixed(1) + "%";
            let wr = sortedQueryInfo[i].winrate;
            let winrateOut = (!wr || isNaN(wr)) ? "n/a" : ((wr > 1 ? "+" : "") + `${wr.toFixed(1)}%, `);

            let moveSanOut = sortedQueryInfo[i].moveSan;
            for (let index = 0; index < 5 - sortedQueryInfo[i].moveSan.length; index++) {
                moveSanOut += " ";
            }

            const pweOut = nextPWE.toFixed(2);
            $queryOutput.append(`<p style="color: ${blendedColor};">
                ${sortedQueryInfo[i].note[0]} 
                ${moveSanOut}
                (${convertFormatEval(sortedQueryInfo[i].score, game.turn())},
                ${winrateOut}
                ${isNaN(sortedQueryInfo[i].total) ? "" : `${populationOut}`})
                ${pweOut} ${timidDisplay}
            </p>`);
        }
    }

    // Sorting State: Tracks dropdown selections and last-edited criteria
    const sortingState = {
        player: { red: "tricky", green: "WRtimid", blue: "forceful" },
        opponent: { red: "tricky", green: "WRtimid", blue: "forceful" },
        lastEdited: { player: "blue", opponent: "blue" }, // Default sorting criteria is "forceful"
      };
      
      // Function to update sorting state and apply active selection styling
    function updateSortingState(type, color, value) {
        // Update state and mark last edited
        sortingState[type][color] = value;
        sortingState.lastEdited[type] = color;
    
        // Remove highlights from all, reset padding
        document.querySelectorAll(`#${type}-box .rgb-option`).forEach(el => {
        el.classList.remove("active-selection");
        el.style.padding = "6px"; // Reset padding for non-selected elements
        });
    
        // Highlight and expand the most recently changed selection
        const selectedElement = document.querySelector(`#${type}-${color}`).parentElement;
        selectedElement.classList.add("active-selection");
        selectedElement.style.padding = "12px"; // Make the selected criteria stand out
    
        // De-select the dropdown after selection
        setTimeout(() => document.getElementById(`${type}-${color}`).blur(), 100);
    
        // Sync sorting criteria
        // console.log("Updated Sorting State:", sortingState);
    
        onBoardUpdate();
    }
    
    // Attach event listeners to dropdowns
    ["red", "green", "blue"].forEach(color => {
        const playerDropdown = document.getElementById(`player-${color}`);
        const opponentDropdown = document.getElementById(`opponent-${color}`);
    
        // Normal dropdown change detection, call onBoardUpdate after selection
        playerDropdown.addEventListener("change", function () {
        updateSortingState("player", color, this.value);
        });
    
        opponentDropdown.addEventListener("change", function () {
        updateSortingState("opponent", color, this.value);
        });
    });

    ["player", "opponent"].forEach(type => {
        const lastColor = sortingState.lastEdited[type];
        const selectedElement = document.querySelector(`#${type}-${lastColor}`).parentElement;
        selectedElement.classList.add("active-selection");
        selectedElement.style.padding = "12px"; // Default highlight
    });

    /*The following code is derived from the original work by Alex Davison.
    Original project repository: https://github.com/qiuzhu0/chessdb-mobile
    This portion of the code is licensed under the MIT License:
    MIT License
    Copyright (c) 2023 Alex Davison
    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:
    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.
    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE. */
    const $eval = $("#eval");
    const $lichess = $("#lichess");
    const $pgn = $("#pgn");
    const $goback = $("#go-back");
    const $queryOutput = $("#query-info");
    const $statusDisplay = $("#status-display");
    
    const board = Chessboard("board", {
        draggable: true,
        showNotation: true,
        position: "start",
        moveSpeed: 15,
        snapbackSpeed: 0,
        snapSpeed: 0,
        onDrop: async function (source, target) {
            if (game.move({ from: source, to: target, promotion: "q" }) === null) return "snapback";
            await onBoardUpdate();
        },
        onSnapEnd: () => {
            board.position(game.fen());
            chessSound();
        }
    });
    $(window).resize(board.resize);

    const $whiteSortOptions = $("#white-sort-options");
    const $blackSortOptions = $("#black-sort-options");

    // Event listener for resetting the board
    $("#reset-board").on("click", () => {
        game.reset(); // Reset the chess game to the initial state
        board.start(); // Reset the visual board to the starting position
        onBoardUpdate(); // Update the board and move list to reflect the reset
    });
    // Event listener for dropdowns
    $whiteSortOptions.on("change", () => {
        $whiteSortOptions.blur(); // Deselect the dropdown after selection
        onBoardUpdate(); // Trigger board update
    });

    $blackSortOptions.on("change", () => {
        $blackSortOptions.blur(); // Deselect the dropdown after selection
        onBoardUpdate(); // Trigger board update
    });

    function getTurnFromFEN(fen) {
        const parts = fen.split(" ");
        return parts[1]; // The second element is the turn
    }
    
    function fenAfterMove(fen, moveSan) {
        const tempGame = new Chess(); // Create a new Chess instance
        tempGame.load(fen); // Load the current FEN into the game instance
    
        let pre = tempGame.fen();
    
        // Attempt to make the specified move
        const moveResult = tempGame.move(moveSan);
    
        if (!moveResult) {
            // If the move fails, throw an error
            throw new Error(`Failed to make move: ${moveSan}. Starting FEN: ${pre}`);
        }
    
        if (pre === tempGame.fen()) {
            // If the FEN doesn't change after the move, throw an error
            throw new Error(`Move did not change board state: ${moveSan}. FEN: ${tempGame.fen()}`);
        }
    
        // Return the FEN after the move
        return tempGame.fen();
    }

    const game = new Chess();
    // let queryInfo;
    let sortedQueryInfo;
    let isUpdatingBoard = false;

    function convertEval(e, turn) {
        if (isNaN(e)) return "unknown";
        let evaluation = e / 100;
        if (turn === "b") evaluation *= -1;
        return evaluation;
    }

    function convertFormatEval(e, turn) {
        let evaluation = convertEval(e,turn);
        return ((evaluation < 0) ? "" : "+") + evaluation.toFixed(2);
    }

    function convertScore(e, turn) {
        if (isNaN(e)) return "unknown";
        let score = e * 100;
        if (turn === "b") score *= -1;

        //console("convert score a => b", e, score);
        return score;
    }

    function formatNumber(num) {
        if (num >= 1000000) {
            return (num / 1000000).toFixed(1) + "M";
        } else if (num >= 1000) {
            return (num / 1000).toFixed(1) + "K";
        } else {
            return num.toString();
        }
    }

    // Add an event listener to the flip button
    $("#flip-board").on("click", () => {
        flipBoard();
    });

    function flipBoard() {
        board.flip(); // Flip the board orientation

        // Swap the sorting priorities
        const whiteSort = $whiteSortOptions.val();
        const blackSort = $blackSortOptions.val();
        $whiteSortOptions.val(blackSort); // White gets Black's priority
        $blackSortOptions.val(whiteSort); // Black gets White's priority

        // Update the board and move list
        onBoardUpdate();
    }
    
    $(document).keydown(event => {
        if (isUpdatingBoard) {
            return;
        }

        setTimeout(() => {
            if (event.which === 37) {
                game.undo();
                board.position(game.fen());
                chessSound();
            } else if (event.key === "f") {
                flipBoard();
                //board.flip();
            } else if (event.which === 39) {
                if (sortedQueryInfo[0] !== undefined) {
                    game.move({ from: sortedQueryInfo[0].move.substring(0, 2), to: sortedQueryInfo[0].move.substring(2, 4) });
                    board.position(game.fen());
                    chessSound();
                    onBoardUpdate();
                }
            }
        }, 0);
    });

    $(document).keyup(event => {
        if (event.which === 37) {
            onBoardUpdate();
        };
    });

    $($pgn).on("click", () => {
        navigator.clipboard.writeText(game.pgn());
    });

    $($goback).on("click", () => {
        game.undo();
        board.position(game.fen());
        chessSound();
        onBoardUpdate();
    });

    $eval.text("+0.00");
    $lichess.text("lichess");
    onBoardUpdate();
});

