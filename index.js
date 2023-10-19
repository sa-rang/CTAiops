const express = require("express");
const dotenv = require("dotenv");
const axios = require('axios');
const qs = require('querystringify');
const natural = require('natural');
const { NlpManager } = require('node-nlp');
const manager = new NlpManager({ languages: ['en'], forceNER: true });
const { request, gql } = require('graphql-request')

// init app
const app = express();
//var authToken = null

// Parse JSON bodies
app.use(express.json());
// Parse URL-encoded bodies
app.use(express.urlencoded({ extended: true }));

// enables environment variables by
// parsing the .env file and assigning it to process.env
dotenv.config({
    path: "./.env",
});


app.get('/api/hello', (req, res) => res.send('Hello World!'));

app.get('/api/getProducts', async (req, res) => {

    //res.send('Hello World!')
    let qtext = req?.query?.search || " ";
    res.json(await getProducts(qtext))
});

app.get('/api/calleden', async (req, res) => {
    res.json(await edenAPI())
});


const getProducts = async (qtext) => {
    try {
        console.log("getProducts called")

        const response = await manager.process('en', qtext);
        let queryObj = {}
        if (response && response?.classifications.length) {
            response?.classifications.map((x) => {
                if (x.intent.includes("price") && !queryObj["price"]) {
                    let valueObj = response.sourceEntities.find((x) => x.typeName = "number")
                    queryObj["price"] = valueObj?.text || "*";
                } else if (x.intent.includes("color") && !queryObj["color"]) {
                    let valueObj = x.intent.split(".")
                    queryObj["color"] = valueObj[1]
                }
                else if (x.intent.includes("product") && !queryObj["product"]) {
                    let valueObj = x.intent.split(".")
                    queryObj["product"] = valueObj[1]
                }
            })
            console.log(queryObj)
        }

        let maxPrice = queryObj?.price || "*"
        // if (queryObj?.color) {
        //     qtext = queryObj?.color
        // }
        // if (queryObj?.product) {
        //     qtext = qtext + " " + queryObj?.product
        // }
        //console.log(maxPrice, qtext)

        // get access token
        const Auth_URL = `${process.env.CT_AUTH_HOST}/oauth/token`
        return axios.post(
            Auth_URL,
            'grant_type=client_credentials',
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                auth: {
                    username: `${process.env.CT_CLIENT_ID}`,
                    password: `${process.env.CT_CLIENT_SECRET}`
                }
            }
        ).then((response) => {
            // if access token found 
            if (response?.data) {
                let Auth_Token = `Bearer ${response.data.access_token}`
                let CT_API_URL = `${process.env.CT_API_HOST}/${process.env.CT_PROJECT_KEY}`

                const document = gql`
                query products(
                    $locale: Locale!
                    $limit: Int!
                    $offset: Int!
                    $priceSelector: PriceSelectorInput!
                    $sorts: [String!] = []
                    $filters: [SearchFilterInput!] = [],
                    $text: String = ""
                  ) {
                    productProjectionSearch(
                      locale: $locale
                      text: $text
                      limit: $limit
                      offset: $offset
                      sorts: $sorts
                      priceSelector: $priceSelector
                      filters: $filters
                    ) {
                      total
                      results {
                        # better never select id or cache breaks
                        # https://github.com/apollographql/apollo-client/issues/9429
                        productId: id
                        name(locale: $locale)
                        slug(locale: $locale)

                        masterVariant {
                            # better never select id or cache breaks
                            # https://github.com/apollographql/apollo-client/issues/9429
                            variantId: id
                            sku
                            images {
                                 url 
                            }
                            attributesRaw {
                              name
                              value
                            }
                            scopedPrice {
                              value {
                                currencyCode
                                centAmount
                                fractionDigits
                              }
                              discounted {
                                discount {
                                  name(locale: $locale)
                                }
                                value {
                                  currencyCode
                                  centAmount
                                  fractionDigits
                                }
                              }
                              country
                            }
                          }
                        }
                      }
                    }
                `

                const variables = {
                    "locale": "en",
                    "text": qtext,
                    "limit": 100,
                    "offset": 0,
                    "sorts": null,
                    "priceSelector": {
                        "currency": "EUR",
                        "country": "DE",
                        "channel": null,
                        "customerGroup": null
                    },
                    "filters": [
                        {
                            "model": {
                                "range": {
                                    "path": "variants.scopedPrice.value.centAmount",
                                    "ranges": [{ "from": "*", "to": `${maxPrice * 100}` }]
                                }
                            }
                        }
                    ]
                }
                const requestHeaders = {
                    Authorization: Auth_Token
                }
                return request(`${CT_API_URL}/graphql/`, document, variables, requestHeaders)
            }
        });
    } catch (error) {
        console.error(`Error: ${err.message}, error code: ${err.errorCode}`);
        res.status(err.statusCode).json(err.message);
    }
}


const edenAPI = async () => {
    const options = {
        method: "POST",
        url: "https://api.edenai.run/v2/text/keyword_extraction",
        headers: {
            authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiMGUzZjQ3MTQtNWYyNC00NDRlLWE0YmEtNDcwZjdlYmYzMGQxIiwidHlwZSI6ImFwaV90b2tlbiJ9.7Kfom0tKugY2uNEthP8mRWiM3wzFBPPYT8gtb0lFPqk",
        },
        data: {
            show_original_response: false,
            fallback_providers: "",
            //providers: "microsoft, amazon",
            text: "i want to buy mobile under 300",
            language: "en",
        },
    };

    return axios
        .request(options)
        .then((response) => {
            return response.data
        })
        .catch((error) => {
            console.error(error);
            return error
        });
}


//-----------------------------NLP-----------------------------------------
app.get('/api/trainnlp', async (req, res) => {

    res.json(await nlpTrainer())
});

app.get('/api/getnlp', async (req, res) => {
    let qtext = req?.query?.nlp || " ";
    console.log(qtext)
    const response = await manager.process('en', qtext);
    res.json(response)
});

const nlpTrainer = async () => {
    // Adds the utterances and intents for the NLP

    //price trainer
    manager.addDocument('en', 'under 100', 'price');
    manager.addDocument('en', 'under 200', 'price');
    manager.addDocument('en', 'under 300', 'price');
    manager.addDocument('en', 'under 400', 'price');
    manager.addDocument('en', 'under 500', 'price');
    manager.addDocument('en', 'under 600', 'price');
    manager.addDocument('en', 'under 700', 'price');
    manager.addDocument('en', 'under 800', 'price');
    manager.addDocument('en', 'under 900', 'price');
    manager.addDocument('en', 'under 1500', 'price');
    manager.addDocument('en', 'under 2000', 'price');
    manager.addDocument('en', 'under 2500', 'price');
    manager.addDocument('en', 'under 3000', 'price');
    manager.addDocument('en', 'under 3500', 'price');
    manager.addDocument('en', 'under 4000', 'price');
    manager.addDocument('en', 'under 4500', 'price');
    manager.addDocument('en', 'under 5000', 'price');


    //color trainer
    manager.addDocument('en', 'red', 'color.red');
    manager.addDocument('en', 'green', 'color.green');
    manager.addDocument('en', 'blue', 'color.blue');
    manager.addDocument('en', 'white', 'color.white');
    manager.addDocument('en', 'black', 'color.black');
    manager.addDocument('en', 'grey', 'color.grey');
    manager.addDocument('en', 'yellow', 'color.yellow');
    manager.addDocument('en', 'beige', 'color.beige');
    manager.addDocument('en', 'multicolored', 'color.multicolored');
    manager.addDocument('en', 'brown', 'color.brown');
    manager.addDocument('en', 'pink', 'color.pink');
    manager.addDocument('en', 'silver', 'color.silver');
    manager.addDocument('en', 'gold', 'color.gold');
    manager.addDocument('en', 'oliv', 'color.oliv');
    manager.addDocument('en', 'orange', 'color.orange');
    manager.addDocument('en', 'turquoise', 'color.turquoise');
    manager.addDocument('en', 'petrol', 'color.petrol');
    manager.addDocument('en', 'purple', 'color.purple');

    //productType trainer
    manager.addDocument('en', 'bag', 'product.bag');
    manager.addDocument('en', 'jacket', 'product.jacket');
    manager.addDocument('en', 'jeans', 'product.jeans');
    manager.addDocument('en', 'shoes', 'product.shoes');
    manager.addDocument('en', 'shirt', 'product.shirt');
    manager.addDocument('en', 'sports', 'product.sports');
    manager.addDocument('en', 'handbag', 'product.handbag');
    manager.addDocument('en', 'coat', 'product.coat');
    manager.addDocument('en', 't-shirt', 'product.t-shirt');
    manager.addDocument('en', 'sneaker', 'product.sneaker');
    manager.addDocument('en', 'polo', 'product.polo');
    manager.addDocument('en', 'sweater', 'product.sweater');
    manager.addDocument('en', 'flip flop', 'product.flipflop');
    manager.addDocument('en', 'belt', 'product.belt');
    manager.addDocument('en', 'Bracelet', 'product.Bracelet');
    manager.addDocument('en', 'Scarf', 'product.Scarf');
    manager.addDocument('en', 'Perfume', 'product.Perfume');
    manager.addDocument('en', 'Phone cover', 'product.Phone cover');



    // Train also the NLG
    // manager.addAnswer('en', 'price.100', '100');
    // manager.addAnswer('en', 'price.200', '200');
    // manager.addAnswer('en', 'price.300', '300');
    // manager.addAnswer('en', 'price.400', '400');
    // manager.addAnswer('en', 'price.500', '500');
    // manager.addAnswer('en', 'price.600', '600');
    // manager.addAnswer('en', 'price.700', '700');
    // manager.addAnswer('en', 'price.800', '800');
    // manager.addAnswer('en', 'price.900', '900');
    // manager.addAnswer('en', 'price.1000', '1000');

    // manager.addAnswer('en', 'color.red', 'red');
    // manager.addAnswer('en', 'color.green', 'green');
    // manager.addAnswer('en', 'color.blue', 'blue');
    // manager.addAnswer('en', 'color.white', 'white');
    // manager.addAnswer('en', 'color.black', 'black');
    // manager.addAnswer('en', 'color.yellow', 'yellow');

    await manager.train();
    //manager.save();
    console.log("NLP Trained!")
}

(async () => {
    await nlpTrainer()
})();


// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));