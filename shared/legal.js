'use strict';
// The website's legal pages: company information (the Electronic Communications and Transactions Act, section 43),
// the terms and conditions and the privacy policy (POPIA). The standard privacy policy below is filled with the
// company's details; a site admin can replace it under Settings → Website → Legal & company.
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.Legal = factory(); })(typeof self !== 'undefined' ? self : this, function () {
  function privacy(c) {
    const co = c.company || 'the company', mail = c.email || 'our email address';
    return [
      `${co} ("we") respects your privacy and processes personal information under the Protection of Personal Information Act, 2013 (POPIA). This policy explains what we collect, why, and your rights.`,
      '',
      '1. What we collect',
      '- Account details: name, email address, profile picture (when you sign in with Google), password (stored scrambled) and phone number.',
      '- Booking, quote and invoice details: contact people, addresses, VAT and registration numbers, event details and messages.',
      '- Release forms: your name, contact details, signature and choices, and for a child, the child\'s name and the parent or guardian who signed.',
      '- Recordings: video and photographs made at productions we film, and live streams.',
      '- Use of the website: which streams and videos are watched (counted without names), and technical data such as IP addresses kept for security.',
      '- Payments are handled by PayFast; we do not see or keep card details.',
      '',
      '2. Why we use it',
      '- To provide our services: bookings, quotes, invoices, contracts, productions, streams and payments.',
      '- To contact you about your bookings, account and our services. Marketing email is only sent where allowed, and you can opt out at any time.',
      '- To meet legal and tax obligations, and to keep the website secure.',
      '',
      '3. Sharing',
      '- We do not sell personal information. We share it only with service providers who help us run the service (such as email, hosting, Google sign-in, WhatsApp and PayFast), with your client or production team where that is part of the service, or where the law requires it.',
      '',
      '4. Recordings and children',
      '- People who can be identified in raw footage are only used beyond the final production when they (or, for a child, a parent or legal guardian) signed a release form allowing it.',
      '- We process children\'s personal information only with the consent of a parent or legal guardian, or where the law allows it.',
      '',
      '5. How long we keep it',
      '- Only as long as needed for the purposes above or as the law requires (for example, invoices for five years for tax).',
      '',
      '6. Your rights',
      '- You may ask what personal information we hold about you, ask us to correct or delete it, object to its use, and withdraw consent (withdrawal does not undo use that already happened).',
      `- Contact us at ${mail}. If you are not satisfied, you may complain to the Information Regulator (inforegulator.org.za).`,
      '',
      '7. Security',
      '- We use reasonable technical and organisational measures to protect personal information, including encrypted connections and access limited to the people who need it.',
    ].join('\n');
  }
  return { privacy };
});
