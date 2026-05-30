const mongoose = require('mongoose');
require('dotenv').config();
mongoose.connect('mongodb+srv://vedprakashvp0123_db_user:hj6Hwuw1aDAAyrxr@cluster0.mbdgtde.mongodb.net/email-marketing?appName=Cluster0').then(async () => {
  const accounts = await mongoose.connection.db.collection('accounts').find({}).toArray();
  console.log(accounts);
  await mongoose.connection.db.collection('accounts').updateMany({}, { $set: { smtpPort: 587 } });
  console.log('Port updated to 587 for all accounts.');
  process.exit(0);
});
