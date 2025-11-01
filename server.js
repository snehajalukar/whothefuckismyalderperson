// server.js
const express = require('express');
const axios = require('axios');
const puppeteer = require('puppeteer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('public')); // Serve the HTML file from public folder

// Function to scrape Chicago's ward lookup using Puppeteer
async function getWardUsingPuppeteer(address) {
    let browser;
    try {
        console.log('Launching browser for address:', address);
        
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        
        // Set user agent to look like a real browser
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        
        console.log('Navigating to Chicago ward lookup page...');
        await page.goto('https://gisapps.chicago.gov/WardGeocode/', { 
            waitUntil: 'networkidle2',
            timeout: 30000 
        });
        
        console.log('Page loaded, looking for address input...');
        
        // Wait for the address input field to be available
        await page.waitForSelector('input[type="text"], input[name*="address"], input#address', { timeout: 10000 });
        
        // Find the address input field (try different possible selectors)
        const addressSelector = await page.evaluate(() => {
            // Try various selectors to find the address input
            const selectors = [
                'input[type="text"]',
                'input[name*="address"]',
                'input#address',
                'input[placeholder*="address"]',
                'input[placeholder*="Address"]'
            ];
            
            for (const selector of selectors) {
                const element = document.querySelector(selector);
                if (element) {
                    return selector;
                }
            }
            return null;
        });
        
        if (!addressSelector) {
            throw new Error('Could not find address input field');
        }
        
        console.log('Found address input with selector:', addressSelector);
        
        // Clear and type the address
        await page.click(addressSelector);
        await page.keyboard.down('Control');
        await page.keyboard.press('a');
        await page.keyboard.up('Control');
        await page.type(addressSelector, address);
        
        console.log('Typed address:', address);
        
        // Find and click the submit button
        const submitSelector = await page.evaluate(() => {
            const selectors = [
                'input[type="submit"]',
                'button[type="submit"]',
                'input[value*="Search"]',
                'input[value*="Find"]',
                'button:contains("Search")',
                'button:contains("Find")'
            ];
            
            for (const selector of selectors) {
                const element = document.querySelector(selector);
                if (element) {
                    return selector;
                }
            }
            return null;
        });
        
        if (!submitSelector) {
            // Try pressing Enter instead
            console.log('No submit button found, trying Enter key...');
            await page.keyboard.press('Enter');
        } else {
            console.log('Found submit button with selector:', submitSelector);
            await page.click(submitSelector);
        }
        
        console.log('Waiting for results...');
        
        // Wait for results to load (try different approaches)
        try {
            await page.waitForFunction(() => {
                const text = document.body.innerText.toLowerCase();
                return text.includes('ward') || text.includes('alderman') || text.includes('alderwoman');
            }, { timeout: 15000 });
        } catch (waitError) {
            console.log('No obvious ward result found, checking page content...');
        }
        
        // Extract the results
        const results = await page.evaluate(() => {
            const bodyText = document.body.innerText;
            const htmlText = document.body.innerHTML;
            
            console.log('Page content preview:', bodyText.substring(0, 500));
            
            let ward = null;
            let alderperson = null;
            let officeAddress = null;
            let wardPhone = null;
            
            // Look for the table structure or specific patterns
            // Try to find ward number
            const wardMatch = bodyText.match(/Ward:\s*(\d+)/i) || bodyText.match(/Ward\s+(\d+)/i);
            if (wardMatch) {
                ward = wardMatch[1];
            }
            
            // Look for alderman/alderwoman name
            const alderpersonMatch = bodyText.match(/Alderman:\s*([^\n\r]+)/i) || 
                                   bodyText.match(/Alderwoman:\s*([^\n\r]+)/i) ||
                                   bodyText.match(/Alderperson:\s*([^\n\r]+)/i);
            if (alderpersonMatch) {
                alderperson = alderpersonMatch[1].trim();
            }
            
            // Look for office address
            const officeMatch = bodyText.match(/Office Address:\s*([^\n\r]+)/i);
            if (officeMatch) {
                officeAddress = officeMatch[1].trim();
            }
            
            // Look for ward phone
            const phoneMatch = bodyText.match(/Ward Phone:\s*([^\n\r]+)/i) ||
                              bodyText.match(/Phone:\s*(\([0-9]{3}\)\s*[0-9]{3}-[0-9]{4})/i);
            if (phoneMatch) {
                wardPhone = phoneMatch[1].trim();
            }
            
            // Alternative: try to parse table structure if it exists
            const tables = document.querySelectorAll('table');
            tables.forEach(table => {
                const rows = table.querySelectorAll('tr');
                rows.forEach(row => {
                    const cells = row.querySelectorAll('td, th');
                    if (cells.length >= 2) {
                        const label = cells[0].innerText.trim().toLowerCase();
                        const value = cells[1].innerText.trim();
                        
                        if (label.includes('ward') && !label.includes('phone') && !label.includes('address')) {
                            ward = value;
                        } else if (label.includes('alderman') || label.includes('alderwoman')) {
                            alderperson = value;
                        } else if (label.includes('office') && label.includes('address')) {
                            officeAddress = value;
                        } else if (label.includes('phone')) {
                            wardPhone = value;
                        }
                    }
                });
            });
            
            return {
                ward,
                alderperson,
                officeAddress,
                wardPhone,
                bodyText: bodyText.substring(0, 1000), // For debugging
                found: ward !== null || alderperson !== null
            };
        });
        
        console.log('Extraction results:', results);
        
        if (results.ward) {
            return { 
                ward: results.ward, 
                alderperson: results.alderperson,
                officeAddress: results.officeAddress,
                wardPhone: results.wardPhone
            };
        } else {
            throw new Error('No ward information found in results');
        }
        
    } catch (error) {
        console.error('Puppeteer error:', error.message);
        throw error;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// Test endpoint to verify server is working
app.get('/api/test', (req, res) => {
    res.json({ 
        success: true, 
        message: 'Server is running!',
        timestamp: new Date().toISOString()
    });
});

// API endpoint to lookup alderperson
app.post('/api/lookup', async (req, res) => {
    try {
        const { address } = req.body;
        
        if (!address) {
            return res.status(400).json({ 
                success: false, 
                error: 'Address is required' 
            });
        }

        console.log('Starting lookup for address:', address);
        
        // Use Puppeteer to scrape Chicago's ward lookup
        let ward = null;
        let alderpersonFromScrape = null;
        let officeAddressFromScrape = null;
        let wardPhoneFromScrape = null;
        
        try {
            const scrapeResults = await getWardUsingPuppeteer(address);
            ward = scrapeResults.ward;
            alderpersonFromScrape = scrapeResults.alderperson;
            officeAddressFromScrape = scrapeResults.officeAddress;
            wardPhoneFromScrape = scrapeResults.wardPhone;
            console.log('Puppeteer found ward:', ward, 'alderperson:', alderpersonFromScrape, 'office:', officeAddressFromScrape, 'phone:', wardPhoneFromScrape);
        } catch (scrapeError) {
            console.log('Puppeteer scraping failed:', scrapeError.message);
            
            return res.status(404).json({
                success: false,
                error: 'Could not find ward information for this address. Please verify the address is within Chicago city limits and try a more specific format.'
            });
        }

        if (!ward) {
            return res.status(404).json({
                success: false,
                error: 'Could not determine ward for this address. Please verify the address is within Chicago city limits.'
            });
        }

        // Get detailed alderperson info from Chicago's data portal
        console.log('Looking up detailed alderperson info for ward:', ward);
        const alderpersonResponse = await axios.get('https://data.cityofchicago.org/resource/htai-wnw4.json', {
            params: {
                ward: ward
            },
            timeout: 10000
        });

        if (!alderpersonResponse.data || alderpersonResponse.data.length === 0) {
            // If we got the name from scraping but no detailed data, use what we have
            if (alderpersonFromScrape) {
                return res.json({
                    success: true,
                    alderperson: alderpersonFromScrape,
                    ward: ward,
                    contact: 'Contact information not available',
                    address: address,
                    wardOffice: null
                });
            }
            
            return res.status(404).json({
                success: false,
                error: `No alderperson data found for Ward ${ward}.`
            });
        }

        const alderpersonData = alderpersonResponse.data[0];
        
        // Format contact information
        let contact = [];
        if (alderpersonData.address) contact.push(alderpersonData.address);
        if (alderpersonData.phone) contact.push(alderpersonData.phone);
        if (alderpersonData.email) contact.push(alderpersonData.email);
        if (alderpersonData.website) contact.push(alderpersonData.website);

        // Debug: log the alderperson data to see what we're getting
        console.log('Raw alderperson data:', JSON.stringify(alderpersonData, null, 2));
        console.log('Contact array:', contact);

        const result = {
            success: true,
            alderperson: alderpersonData.alderman || alderpersonData.alderperson || alderpersonData.name || alderpersonFromScrape || 'Name not available',
            ward: ward,
            contact: contact.length > 0 ? contact.filter(item => typeof item === 'string').join(' • ') : 'Contact information not available',
            address: address,
            wardOffice: officeAddressFromScrape || alderpersonData.address || null,
            wardPhone: wardPhoneFromScrape || alderpersonData.phone || null
        };

        console.log('Successfully found:', result);
        res.json(result);

    } catch (error) {
        console.error('Error looking up alderperson:', error.message);
        
        res.status(500).json({
            success: false,
            error: 'An error occurred while looking up your alderperson. Please try again.'
        });
    }
});

// Serve the main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Who The F*** Is My Alderperson server running on port ${PORT}`);
    console.log(`Visit http://localhost:${PORT} to use the app`);
    console.log(`\nThis app uses browser automation to access Chicago's ward lookup service.`);
    console.log(`Note: First lookup may be slow as it launches a browser instance.`);
});