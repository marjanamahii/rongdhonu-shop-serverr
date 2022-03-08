const express = require('express');
const app = express();
const cors = require('cors');
var admin = require("firebase-admin");
const { MongoClient } = require('mongodb');
require('dotenv').config();
const ObjectId = require('mongodb').ObjectId;
const stripe = require('stripe')(process.env.STRIPE_SECRET);

const port = process.env.PORT || 7000;

// firebase admin initialization
// var serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
var serviceAccount = require('./rongdhonu-shop-4fb61-firebase-adminsdk-u0o4e-cf687377af.json')

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});


// middleware
app.use(cors());
app.use(express.json());
// app.use(fileUpload());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.yt3ul.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });

async function verifyToken(req, res, next) {
    if (req.headers?.authorization?.startsWith('Bearer ')) {
        const idToken = req.headers.authorization.split('Bearer ')[1];
        try {
            const decodedUser = await admin.auth().verifyIdToken(idToken);
            req.decodedUserEmail = decodedUser.email;
        }
        catch {

        }
    }
    next();
}

async function run() {
    try {
        await client.connect();
        const database = client.db('online_shop');
        const productCollection = database.collection('products');
        const orderCollection = database.collection('orders');
        const usersCollection = database.collection('users');
        const reviewsCollection = database.collection('reviews');

        //GET Products API
        app.get('/products', async (req, res) => {
            const cursor = productCollection.find({});
            const page = req.query.page;
            const size = parseInt(req.query.size);
            let products;
            const count = await cursor.count();

            if (page) {
                products = await cursor.skip(page * size).limit(size).toArray();
            }
            else {
                products = await cursor.toArray();
            }

            res.send({
                count,
                products
            });
        });

        // Use POST to get data by keys
        app.post('/products/byKeys', async (req, res) => {
            const keys = req.body;
            const query = { key: { $in: keys } }
            const products = await productCollection.find(query).toArray();
            res.send(products);
        });

        // Add Orders API
        app.get('/orders', verifyToken, async (req, res) => {

            const email = req.query.email;
            // console.log("Email: ", email);
            // console.log("Decoded User Email: ", req.decodedUserEmail);
            const query = { email: email };

            const cursor = orderCollection.find(query);

            const orders = await cursor.toArray();

            res.json(orders);

            // if (req.decodedUserEmail === email) {
            //     const query = { email: email };
            //     const cursor = orderCollection.find(query);
            //     const orders = await cursor.toArray();
            //     res.json(orders);
            // }
            // else {
            //     res.status(401).json({ message: `User not authorized, email: ${email}` })
            // }

        });

        // order filter from database by email
        app.get("/orders/:email", async (req, res) => {
            const email = req.params.email;
            const query = { email: email };
            const result = await orderCollection.find(query).toArray();
            res.send(result);
        });

        //post orders to Database
        app.post('/orders', async (req, res) => {
            const order = req.body;
            order.createdAt = new Date();
            const result = await orderCollection.insertOne(order);
            res.json(result);
        });

        // update status order
        app.put("/orders/:id", async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const updateDoc = {
                $set: {
                    status: "Shipped",
                },
            };
            const result = await orderCollection.updateOne(query, updateDoc);
            res.send(result);
        });

        // cancel customer order
        app.delete("/orders/:id", async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const result = await orderCollection.deleteOne(query);
            res.send(result);
        });

        app.get('/users', async (req, res) => {
            const cursor = usersCollection.find({});
            const users = await cursor.toArray();
            res.json(users);
        });

        app.get('/users/:email', async (req, res) => {
            const email = req.params.email;
            const query = { email: email };

            // console.log("User Query: ", query);

            const user = await usersCollection.findOne(query);

            // console.log("User: ", user);

            let isAdmin = false;
            if (user?.role === 'admin') {
                // console.log("add admin");
                isAdmin = true;
            }
            res.json({ admin: isAdmin });
        });

        app.post('/users', verifyToken, async (req, res) => {
            const user = req.body;
            const result = await usersCollection.insertOne(user);
            console.log(result);
            res.json(result);
        });

        app.put('/users', verifyToken, async (req, res) => {
            const user = req.body;
            const filter = { email: user.email };
            const options = { upsert: true };
            const updateDoc = { $set: user };
            const result = await usersCollection.updateOne(filter, updateDoc, options);
            res.json(result);
        });

        app.put('/users/admin', verifyToken, async (req, res) => {
            const user = req.body;
            // console.log("Req: ", req.body);
            // const requester = req.decodedEmail;
            const requester = req.body.requester_email;
            // console.log("Requester: ", req.body.requester_email);

            if (requester) {
                const requesterAccount = await usersCollection.findOne({ email: requester });
                if (requesterAccount.role === 'admin') {
                    const filter = { email: user.email };
                    const updateDoc = { $set: { role: 'admin' } };
                    const result = await usersCollection.updateOne(filter, updateDoc);
                    res.json(result);
                }
            }
            else {
                res.status(403).json({ message: 'you do not have access to make admin' })
            }

        })

        // image upload with add product
        app.post('/addProduct', async (req, res) => {
            const name = req.body.name;
            const price = req.body.price;
            const stock = req.body.stock;
            // const description = req.body.description;
            const myImage = req.files.img;
            const picData = myImage.data;
            const encodedPic = picData.toString('base64');
            const img = Buffer.from(encodedPic, 'base64');

            // const product = { name, brand, processor, ram, hdd, sdd, price, description, image, gen };
            const product = { name, price, img };

            const result = await productCollection.insertOne(product);
            res.send(result);
        })

        //get reviews
        app.get('/reviews', async (req, res) => {
            const cursor = reviewsCollection.find({});
            const review = await cursor.toArray()
            res.send(review)
        });
        // post reviews
        app.post('/reviews', async (req, res) => {
            const review = req.body;
            const result = await reviewsCollection.insertOne(review);
            console.log('hitting the review', req.body);
            console.log('got user', result);
            res.json(result);
        });
        // get single reviews

        app.get('/reviews/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const review = await reviewsCollection.findOne(query);
            res.json(review);
        })

        // delete single reviews
        app.delete('/reviews/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectID(id) };
            const review = await reviewsCollection.deleteOne(query);
            res.json(review);
        });

        // 4242424242424242 card number for testing
        app.post('/create-payment-intent', async (req, res) => {
            const paymentInfo = req.body;
            // cent a gun hoy 100 te
            const amount = +paymentInfo.price * 100;
            const paymentIntent = await stripe.paymentIntents.create({
                currency: 'usd',
                amount: amount,
                payment_method_types: ['card']
            });
            res.json({ clientSecret: paymentIntent.client_secret });
        })

        app.put('/payments/:id', async (req, res) => {
            const id = req.params.id;
            const payment = req.body;
            const filter = { _id: ObjectId(id) };
            const updateDoc = {
                $set: {
                    payment: payment
                }
            };
            const result = await orderCollection.updateOne(filter, updateDoc);
            res.send(result);
        })
    }
    finally {
        // await client.close();
    }
}

run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('Rongdhonu shops server is running');
});

app.listen(port, () => {
    console.log('Server running at port', port);
})