const Apify = require('apify')
const { utils: { log } } = Apify

const { clearLink, handleProduct, classifierProduct, validateProduct, productStore
} = require('./product')

require('dotenv').config()
const { MongoClient } = require('mongodb')
const uri = process.env.MONGO_URI
const dbName = process.env.DB_NAME

Apify.main(async () => {
    const client = new MongoClient(uri)
    await client.connect()
    const db = client.db(dbName)

    const { host, pseudoUrls, startUrls, selectors, categories } =
        await Apify.getInput();

    const baseURL = `http[s?]://${host}`
    const increaseBaseURL = pseudoUrl => baseURL + pseudoUrl
    const pseudoUrlsCategory = pseudoUrls.category.map(increaseBaseURL)
    const pseudoUrlsProduct = pseudoUrls.product.map(increaseBaseURL)

    const categorizeProduct = classifierProduct(categories)

    const requestList = await Apify.openRequestList('startUrls', startUrls)
    const requestQueue = await Apify.openRequestQueue()
    // const proxyConfiguration = await Apify.createProxyConfiguration()

    let collected = valid = invalid = 0

    const crawler = new Apify.CheerioCrawler({
        requestList,
        requestQueue,
        // proxyConfiguration,
        useSessionPool: true,
        persistCookiesPerSession: true,
        // Be nice to the websites.
        // Remove to unleash full power.
        maxConcurrency: 50,
        // You can remove this if you won't
        // be scraping any JSON endpoints.
        // additionalMimeTypes: [
        //     'application/json',
        // ],
        handlePageFunction: async ({ $, request: { url, loadedUrl,
            userData: { label } } }) => {
            // crawler.log.info('Page Opened', { label, url })

            Apify.utils.enqueueLinks({
                $,
                requestQueue,
                baseUrl: loadedUrl,
                pseudoUrls: pseudoUrlsCategory,
                transformRequestFunction: req => {
                    req.userData.label = 'CATEGORY'
                    return req
                }
            })

            Apify.utils.enqueueLinks({
                $,
                requestQueue,
                baseUrl: loadedUrl,
                pseudoUrls: pseudoUrlsProduct,
                transformRequestFunction: req => {
                    req.userData.label = 'PRODUCT'
                    return req
                }
            })

            if (label == 'PRODUCT') {
                collected++
                const link = clearLink(url)

                const product = handleProduct($, selectors)
                product.host = host
                product.link = link

                const { categories } = product
                product.categories = categories && categorizeProduct(categories)

                const invalido = validateProduct(product)
                if (invalido.length === 0) {
                    valid++
                    return productStore(db, product)
                }

                invalid++
                log.info('❌', { invalido, link })
            }
        }
    })

    await crawler.run()
    client.close()
    log.info('Metrics', {
        collected,
        valid,
        invalid,
    })
})