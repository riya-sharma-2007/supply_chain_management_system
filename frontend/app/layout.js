import "./globals.css";

export const metadata = {
  title: "Smart Inventory",
  description: "Inventory and supply chain management dashboard",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
