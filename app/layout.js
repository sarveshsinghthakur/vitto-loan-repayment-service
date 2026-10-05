import './globals.css';

export const metadata = {
  title: 'Vitto Loan Repayment Service',
  description: 'Loan repayment schedules, payments and current position for MSME lending',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
