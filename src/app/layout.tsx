import "~/styles/globals.css";

import { GeistSans } from "geist/font/sans";
import { type Metadata } from "next";

export const metadata: Metadata = {
  title: "Patch Pulse",
  description: "Keep a pulse on npm package updates",
  icons: [{ rel: "icon", url: "/favicon.ico" }],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${GeistSans.variable}`}>
      <body className="flex flex-col gap-4">
        <TopNav />
        {children}
      </body>
    </html>
  );
}

function TopNav() {
  return (
    <nav className="items-cents flex min-w-full justify-between border-b-[3px] border-b-[#25ED9C] p-4 pt-1 text-xl font-semibold">
      <Logo />
      <div className="relative top-2">Sign in</div>
    </nav>
  );
}

function Logo() {
  return (
    <svg
      width="221px"
      viewBox="0 0 1986 456"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{
        marginBottom: "-36.75px",
      }}
    >
      <rect width="1986" height="456" fill="black" />
      <path
        d="M85.6299 156.25H119.38C129.713 156.25 137.88 153.5 143.88 148C150.047 142.5 153.13 134.833 153.13 125C153.13 114.5 150.13 106.583 144.13 101.25C138.13 95.9167 129.963 93.25 119.63 93.25H85.6299L91.3799 86.75V236H62.3799V65.75H123.13C135.297 65.75 145.797 68.3333 154.63 73.5C163.63 78.5 170.63 85.5 175.63 94.5C180.63 103.333 183.13 113.5 183.13 125C183.13 136.333 180.63 146.5 175.63 155.5C170.63 164.333 163.63 171.25 154.63 176.25C145.63 181.25 135.13 183.75 123.13 183.75H85.6299V156.25Z"
        fill="white"
      />
      <path
        d="M503.039 235V83H532.039V235H503.039ZM450.789 92.25V64.75H586.289V92.25H450.789ZM712.09 237.75C694.757 237.75 679.59 234 666.59 226.5C653.59 218.833 643.507 208.417 636.34 195.25C629.34 181.917 625.84 166.833 625.84 150C625.84 137.333 627.923 125.667 632.09 115C636.423 104.167 642.423 94.8333 650.09 87C657.923 79.1667 667.09 73.0833 677.59 68.75C688.09 64.4167 699.59 62.25 712.09 62.25C731.59 62.25 747.59 66.3333 760.09 74.5C772.59 82.6667 782.59 93.9167 790.09 108.25L762.59 117.5C755.59 107.333 747.923 100.25 739.59 96.25C731.423 92.25 722.257 90.25 712.09 90.25C701.257 90.25 691.59 92.8333 683.09 98C674.59 103 667.84 110 662.84 119C657.84 128 655.34 138.333 655.34 150C655.34 161.667 657.84 172 662.84 181C667.84 190 674.59 197.083 683.09 202.25C691.59 207.25 701.257 209.75 712.09 209.75C722.257 209.75 731.423 207.75 739.59 203.75C747.923 199.75 755.59 192.667 762.59 182.5L790.09 191.75C782.59 206.083 772.59 217.333 760.09 225.5C747.59 233.667 731.59 237.75 712.09 237.75ZM957.609 235V64.75H986.609V235H957.609ZM851.859 235V64.75H880.859V235H851.859ZM870.859 165.5V138H966.609V165.5H870.859Z"
        fill="white"
      />
      <path
        d="M1208.55 155.25H1242.3C1252.63 155.25 1260.8 152.5 1266.8 147C1272.97 141.5 1276.05 133.833 1276.05 124C1276.05 113.5 1273.05 105.583 1267.05 100.25C1261.05 94.9167 1252.88 92.25 1242.55 92.25H1208.55L1214.3 85.75V235H1185.3V64.75H1246.05C1258.22 64.75 1268.72 67.3333 1277.55 72.5C1286.55 77.5 1293.55 84.5 1298.55 93.5C1303.55 102.333 1306.05 112.5 1306.05 124C1306.05 135.333 1303.55 145.5 1298.55 154.5C1293.55 163.333 1286.55 170.25 1277.55 175.25C1268.55 180.25 1258.05 182.75 1246.05 182.75H1208.55V155.25ZM1407.11 237.75C1393.61 237.75 1381.86 235.167 1371.86 230C1361.86 224.833 1354.03 217.083 1348.36 206.75C1342.86 196.417 1340.11 183.75 1340.11 168.75V64.75H1369.11V166.5C1369.11 180.167 1372.36 190.833 1378.86 198.5C1385.53 206 1394.94 209.75 1407.11 209.75C1419.61 209.75 1429.11 206 1435.61 198.5C1442.11 190.833 1445.36 180.167 1445.36 166.5V64.75H1474.36V168.75C1474.36 183.75 1471.53 196.417 1465.86 206.75C1460.36 217.083 1452.61 224.833 1442.61 230C1432.61 235.167 1420.78 237.75 1407.11 237.75ZM1624.03 235H1523.78V64.75H1552.78V214.5L1547.78 207.5H1624.03V235ZM1713.34 239C1704.17 239 1695.42 237.667 1687.09 235C1678.76 232.167 1671.17 227.75 1664.34 221.75C1657.51 215.583 1651.76 207.5 1647.09 197.5L1670.59 183.5C1676.09 193.167 1682.34 200.25 1689.34 204.75C1696.34 209.25 1704.76 211.5 1714.59 211.5C1723.76 211.5 1730.67 209.5 1735.34 205.5C1740.17 201.5 1742.59 196 1742.59 189C1742.59 184.833 1741.51 181.25 1739.34 178.25C1737.34 175.083 1733.67 172.167 1728.34 169.5C1723.17 166.667 1715.76 164.083 1706.09 161.75C1692.76 158.417 1682.34 154.333 1674.84 149.5C1667.34 144.5 1662.09 138.75 1659.09 132.25C1656.09 125.583 1654.59 118.333 1654.59 110.5C1654.59 100.833 1656.84 92.4167 1661.34 85.25C1665.84 78.0833 1672.34 72.4167 1680.84 68.25C1689.34 64.0833 1699.42 62 1711.09 62C1724.92 62 1736.34 64.6667 1745.34 70C1754.51 75.3333 1762.09 82.4167 1768.09 91.25L1744.34 107C1739.51 100.833 1734.17 96.5 1728.34 94C1722.67 91.3333 1716.76 90 1710.59 90C1701.76 90 1695.01 91.75 1690.34 95.25C1685.67 98.5833 1683.34 103.5 1683.34 110C1683.34 115.5 1685.59 120.25 1690.09 124.25C1694.59 128.25 1703.34 131.833 1716.34 135C1730.34 138.5 1741.42 142.667 1749.59 147.5C1757.76 152.167 1763.51 157.917 1766.84 164.75C1770.34 171.417 1772.09 179.417 1772.09 188.75C1772.09 198.25 1769.67 206.75 1764.84 214.25C1760.01 221.75 1753.17 227.75 1744.34 232.25C1735.67 236.75 1725.34 239 1713.34 239ZM1832.48 163.25V135.75H1901.73V163.25H1832.48ZM1831.73 92.25L1839.98 81.75V215.25L1830.48 207.5H1916.23V235H1810.98V64.75H1916.23V92.25H1831.73Z"
        fill="white"
      />
      <path
        d="M0 346H150L167.5 304L205.5 419.5L309 117L397 402L432 281L457 346H996L1029.5 416.5L1084.5 264.5L1126.5 346H1986"
        stroke="#25ED9C"
        strokeWidth="27"
      />
    </svg>
  );
}
