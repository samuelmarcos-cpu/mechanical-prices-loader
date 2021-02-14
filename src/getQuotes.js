const request = require('request');
const xml2js = require('xml2js');

exports.getQuotes = async () =>
    new Promise((resolve, reject) => {
        const options = {
            'method': 'GET',
            'url': 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml',
            'headers': {
                'Authorization': 'Token d35c17e9c03d8a76e77ca03bd8c9a1b453daefe0',
                'Token': 'd35c17e9c03d8a76e77ca03bd8c9a1b453daefe0'
            }
        };

        request(options, function (err, response) {
            if (err) reject(err)

            const xml = response.body

            xml2js.parseString(xml, (err, json) => {
                if (err) reject(err)

                const quotesRaw = json['gesmes:Envelope']['Cube'][0]['Cube'][0]['Cube']

                const quotes = quotesRaw.reduce((quotes, quoteRaw) => {
                    const quote = quoteRaw['$']
                    quotes[quote['currency']] = quote['rate']
                    return quotes
                }, {})

                resolve(quotes)
            });
        });
    })