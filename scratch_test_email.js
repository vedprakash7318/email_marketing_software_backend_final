const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: 'email-smtp.ap-south-1.amazonaws.com',
  port: 587,
  secure: false, // true for 465, false for other ports
  requireTLS: true,
  tls: { rejectUnauthorized: false },
  auth: {
    user: 'AKIAZTJUYN6JDV7BK2VL',
    pass: 'BASklkgk+d3ZSr5La3eLVAlBOKCp6/2g/rj7+21tXwwY'
  },
  debug: true,
  logger: true
});

transporter.sendMail({
  from: 'info@digicoderstechnologies.com',
  to: 'princeprajapati40164@gmail.com', // one of the emails from their list
  subject: 'Test Email from Node',
  text: 'This is a test email to debug AWS SES.'
}, (err, info) => {
  if (err) {
    console.error('SEND ERROR:', err.message);
    if (err.response) console.error('RESPONSE:', err.response);
  } else {
    console.log('SUCCESS:', info.response);
  }
  process.exit(0);
});
