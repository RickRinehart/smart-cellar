// Smart Cellar — Welcome Email
// /api/send-welcome-email.js
// Uses Resend (thesmartkitchenapp workspace, smart-cellar key)
// RG Digital Labs, LLC · June 2026

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const { email, name } = req.body

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Smart Cellar <hello@thesmartkitchenapp.com>',
        to: [email],
        subject: '🍷 Welcome to Smart Cellar — Your 30-Day Trial Has Started',
        html: `
          <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; background: #0c0e14; color: #ede8f0; padding: 40px 32px; border-radius: 12px;">
            <div style="text-align: center; margin-bottom: 32px;">
              <div style="font-size: 48px; margin-bottom: 8px;">🍷</div>
              <h1 style="font-size: 32px; color: #8b2252; margin: 0; font-weight: 700;">Smart Cellar</h1>
              <p style="color: #c9903a; font-family: 'Georgia', serif; font-size: 16px; margin: 4px 0 0;">by RG Digital Labs</p>
            </div>

            <p style="font-size: 16px; line-height: 1.7; color: #ede8f0;">
              Hi ${name || 'there'},<br/><br/>
              Welcome to <strong style="color: #8b2252;">Smart Cellar</strong> — your AI-powered bar & bottle manager. Your 30-day free trial is now active.
            </p>

            <div style="background: #191c28; border-radius: 10px; padding: 20px; margin: 24px 0; border: 1px solid #262b40;">
              <h3 style="color: #c9903a; margin: 0 0 12px; font-size: 16px;">What you can do right now:</h3>
              <ul style="color: #ede8f0; font-size: 14px; line-height: 1.8; padding-left: 20px; margin: 0;">
                <li><strong>🍾 Build your cellar</strong> — add every bottle with category, proof, and fill level</li>
                <li><strong>⚖ Smart Pour</strong> — connect your Etekcity Bluetooth scale for precision pours</li>
                <li><strong>🍹 Make a Drink</strong> — AI bartender crafts cocktail recipes from your cellar</li>
                <li><strong>✨ What Can I Make?</strong> — discover cocktails from what you already have</li>
                <li><strong>🧪 DIY Ingredients</strong> — guides for simple syrups, bitters, and falernum</li>
              </ul>
            </div>

            <div style="text-align: center; margin: 32px 0;">
              <a href="${process.env.VITE_APP_URL}" style="background: #8b2252; color: #fff; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-size: 15px; font-weight: 700; display: inline-block;">
                Open Smart Cellar →
              </a>
            </div>

            <hr style="border: none; border-top: 1px solid #262b40; margin: 24px 0;" />

            <p style="font-size: 12px; color: #6b728e; line-height: 1.6; text-align: center;">
              Also using Smart Kitchen? Your pours can pair with meal suggestions.<br/>
              <a href="${process.env.VITE_SMART_KITCHEN_URL}" style="color: #f0a500;">Open Smart Kitchen →</a><br/><br/>
              RG Digital Labs, LLC · Veteran-Owned · Grand Rapids, MI
            </p>
          </div>
        `,
      }),
    })
    const data = await response.json()
    res.json({ success: true, id: data.id })
  } catch (err) {
    console.error('Resend error:', err)
    res.status(500).json({ error: 'Email send failed' })
  }
}
