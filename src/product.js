const Apify = require('apify')
const { utils: { log } } = Apify

require('dotenv').config()
const collectionName = process.env.COLLECTION_NAME

const crypto = require("crypto")

const unfriendlyIndex = index => index > 0 ? index - 1 : index

function getArrayPosition(array, index) {
    const start = unfriendlyIndex(index)
    const end = start < 0 ? array.length - start + 1 : start + 1
    return array.slice(start, end).shift()
}

const cheerioSelector = $ => ({ selector, attribute, position, match }) => {
    const values = []

    $(selector).each(function () {
        const el = $(this)
        let value = attribute ? el.attr(attribute) : el.text()

        if (match && match.regex) {
            const matched = value.match(match.regex)

            if (matched && match.group) {
                value = getArrayPosition(matched, match.group)
            }
        }

        values.push(value)
    })

    return position ? getArrayPosition(values, position) : values
}

const composition = (...fs) => vl => fs.reduce((acc, f) => f(acc), vl)
const compositionWithTest = (test, ...fs) => vl => {
    if (test(vl)) return vl

    fs.forEach(f => {
        if (test(vl)) return vl

        vl = f(vl)
    })

    return vl
}
const compositionSafe = (...fs) =>
    compositionWithTest(vl => vl === null || vl === undefined, ...fs)

const priceString2Float = priceStr => {
    const price = parseFloat(priceStr.replace(',', ''))
    return price === NaN ? null : price
}

const clearHTMLText = text => typeof text === 'string' ? text.trim() : ''
exports.clearLink = composition(clearHTMLText, text => text.split('//').pop())

exports.classifierProduct = categoryLabel => labels =>
    labels.reduce((categories, label) =>
        Object.keys(categoryLabel).reduce((categoriesMatched, category) =>
            categoryLabel[category].
                filter(expectedLabel => expectedLabel === label).
                length > 0 ? [...categoriesMatched, category] : categoriesMatched,
            categories
        ), [])

exports.handleProduct = ($, {
    categories, sku, title, description, price, images, attributesKey, attributesValue
}) => {
    const selector = cheerioSelector($)
    const productImages = images && selector(images).map(exports.clearLink)

    const selMultText = compositionSafe(selector, v => v.map(clearHTMLText))

    const keys = selMultText(attributesKey)
    const specsList = selMultText(attributesValue)

    const attributes = keys && keys.reduce((attr, key) => {
        attr[key] = specsList.shift()
        return attr
    }, {})

    const selClearText = compositionSafe(selector, clearHTMLText)
    const selPrice = compositionSafe(selector, priceString2Float)

    return {
        categories: selMultText(categories),
        sku: selClearText(sku),
        title: selClearText(title),
        description: selClearText(description),
        price: selPrice(price),
        images: productImages,
        attributes, specsList
    }
}

const makeTest = (fnTest, errorMsg = 'ERROR') =>
    value => fnTest(value) ? true : errorMsg

const testProductCategories = makeTest(
    product => product.categories && product.categories.length > 0,
    'Sem Categoria'
)

const makeTestObjectAttribute = attr => makeTest(
    product => product[attr],
    `SEM '${attr}'`
)

const testProductSKU = makeTestObjectAttribute('sku')
const testProductTitle = makeTestObjectAttribute('title')
const testProductPrice = makeTestObjectAttribute('price')

const testProductPriceNotEmpty = makeTest(
    product => product.price != null,
    'Preço Vazio'
)

const validators = [
    testProductCategories,
    testProductSKU,
    testProductTitle,
    testProductPrice,
    testProductPriceNotEmpty
]

exports.validateProduct = product =>
    validators.map(validator => validator(product)).
        filter(result => typeof result === 'string')

const generateProductHash = ({ host, sku }) => crypto.createHash("sha256").
    update(host + sku).digest("hex")

exports.productStore = async (db, product) => {
    const { title, price } = product
    delete product.price
    priceStore = {
        date: new Date(),
        price
    }

    const productsRef = db.collection(collectionName)
    const id = generateProductHash(product)
    const findProduct = { _id: id }
    const productStored = await productsRef.findOne(findProduct)

    const productLog = { title, id }

    if (productStored) {
        log.info('✔️  UPDATE PRODUCT', productLog)
        const { timeline } = productStored
        timeline.push(priceStore)
        return productsRef.updateOne(findProduct, { $set: { timeline } })
    }

    log.info('✔️  INSERT PRODUCT', productLog)
    product._id = id
    product.timeline = [priceStore]
    return productsRef.insertOne(product)
}