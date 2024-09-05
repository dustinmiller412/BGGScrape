const puppeteer = require('puppeteer'); // Import Puppeteer to automate the browser
const { google } = require('googleapis'); // Import Google APIs client library
const keys = require('./credentials.json'); // Import credentials for Google Sheets API

// Authenticate with Google API using a service account
async function authenticate() {
  const client = new google.auth.JWT(
    keys.client_email, // Email of the service account
    null, // No key file, the key is passed directly
    keys.private_key, // Private key of the service account
    ['https://www.googleapis.com/auth/spreadsheets'] // Scopes for accessing Google Sheets
  );

  await client.authorize(); // Authorize the client
  return client; // Return the authorized client
}

// Function to scrape game details from BoardGameGeek
async function scrapeGameDetails(gameTitle) {
  const browser = await puppeteer.launch({ headless: true }); // Launch Puppeteer in headless mode
  const page = await browser.newPage(); // Open a new browser page

  await page.goto('https://boardgamegeek.com'); // Navigate to the BoardGameGeek website

  // Type the game title into the search box and press enter
  await page.type('input[placeholder="Search"]', gameTitle);
  await page.keyboard.press('Enter');

  // Wait for the results page to load and display results
  await page.waitForSelector('.collection_table');

  // Click the first game link in the results table
  await page.evaluate(() => {
    const firstResult = document.querySelector('.collection_table .primary');
    if (firstResult) {
      firstResult.click(); // Click the first result if it exists
    }
  });

  // Wait for the game details page to load and display
  await page.waitForNavigation();

  // Scrape the game details from the page
  const gameData = await page.evaluate(() => {
    const rankElement = document.querySelector('.game-header-ranks .rank-value');
    const rank = rankElement ? rankElement.innerText.trim() : 'Rank not found'; // Scrape game rank

    const ratingElement = document.querySelector('.rating-overall .ng-binding');
    const rating = ratingElement ? ratingElement.innerText.trim() : 'Rating not found'; // Scrape game rating

    const minPlayersElement = document.querySelector('.gameplay-item-primary meta[itemprop="minValue"]');
    const maxPlayersElement = document.querySelector('.gameplay-item-primary meta[itemprop="maxValue"]');
    const minPlayers = minPlayersElement ? parseInt(minPlayersElement.getAttribute('content')) : 0; // Scrape minimum players
    const maxPlayers = maxPlayersElement ? parseInt(maxPlayersElement.getAttribute('content')) : 0; // Scrape maximum players

    let players = 'Players not found';
    if (minPlayers > 0 && maxPlayers > 0) {
      // Construct a string for players range (e.g., "2, 3, 4")
      players = '';
      for (let i = minPlayers; i <= maxPlayers; i++) {
        players += i;
        if (i !== maxPlayers) {
          players += ', ';
        }
      }
    }

    const bestPlayersElement = document.querySelector('.gameplay-item-secondary span.ng-binding:nth-child(3)');
    const bestPlayersText = bestPlayersElement ? bestPlayersElement.innerText.trim() : 'Best players not found';
    const bestPlayers = bestPlayersText.includes('Best: ') ? bestPlayersText.split('Best: ')[1].trim() : 'Best players not found'; // Scrape best players

    const playingTimeElement = document.querySelector('.gameplay-item[itemprop="numberOfPlayers"] + .gameplay-item .gameplay-item-primary span');
    const playingTime = playingTimeElement ? playingTimeElement.innerText.trim() : 'Playing time not found'; // Scrape playing time

    const weightElement = document.querySelector('.gameplay-item-primary .gameplay-weight-medium, .gameplay-item-primary .gameplay-weight-light, .gameplay-item-primary .gameplay-weight-heavy');
    const weight = weightElement ? weightElement.innerText.trim() : 'Weight not found'; // Scrape game weight (difficulty)

    // Scrape game prices and calculate used buy and sell prices
    const prices = Array.from(document.querySelectorAll('.summary.summary-condensed.summary-border.summary-sale li .summary-sale-item-price strong'))
      .map(priceElement => parseFloat(priceElement.textContent.replace(/[^0-9.]/g, '')))
      .filter(price => !isNaN(price));

    const suggestedRetail = prices.length > 0 ? Math.min(...prices) : 0; // Find the minimum price as suggested retail
    const usedBuyPrice = (suggestedRetail / 4).toFixed(2); // Calculate used buy price
    const usedSellPrice = (suggestedRetail / 2).toFixed(2); // Calculate used sell price

    return {
      rank,
      rating,
      players,
      bestPlayers,
      playingTime,
      weight,
      suggestedRetail,
      usedBuyPrice,
      usedSellPrice
    };
  });

  await browser.close(); // Close the browser
  return gameData; // Return the scraped game data
}

// Function to update Google Spreadsheet with the scraped game data
async function updateSpreadsheet(auth) {
  const sheets = google.sheets({ version: 'v4', auth }); // Initialize Google Sheets API
  const spreadsheetId = '1HTupDDA6s00httM4P-1NRhu0wnB-qE51NYJ8VEATnVc';

  // Get the existing game titles from the spreadsheet in column A
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Sheet5!A2:A',
  });

  const rows = response.data.values;
  if (rows.length) {
    // Loop through each game title in the spreadsheet in column A
    for (let i = 0; i < rows.length; i++) {
      const gameTitle = rows[i][0]; // Extract game title from the current row
      if (gameTitle) {
        console.log(`Processing game: ${gameTitle}`); // Log the game being processed
        const gameData = await scrapeGameDetails(gameTitle); // Scrape the game data
        console.log(gameData); // Log the scraped data

        // Update the corresponding row with the scraped data
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `Sheet5!B${i + 2}:K${i + 2}`, // Update columns B to K for the row
          valueInputOption: 'RAW',
          resource: {
            values: [[gameData.rank, gameData.rating, gameData.players, 
              gameData.bestPlayers, gameData.playingTime, gameData.weight, 
              gameData.suggestedRetail]], // Add the scraped game details
          },
        });
      }
    }
  } else {
    console.log('No data found in column A.'); // Log if no data found in column A
  }
}

// Start the authentication and update process
authenticate().then(auth => {
  updateSpreadsheet(auth).catch(console.error); // Update the spreadsheet after authentication
}).catch(console.error); // Handle authentication errors
