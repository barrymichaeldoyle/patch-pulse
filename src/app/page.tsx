const mockPackages = [
  "react",
  "react-dom",
  "react-router-dom",
  "react-scripts",
  "typescript",
];

export default function HomePage() {
  return (
    <main className="p-4">
      <div className="flex flex-wrap gap-4">
        {mockPackages.map((pkg) => (
          <div
            key={pkg}
            className="h-fit w-60 rounded-lg bg-slate-800 p-4 shadow"
          >
            <h3 className="text-xl font-semibold">{pkg}</h3>
            <p className="text-sm text-slate-300">1.0.0</p>
          </div>
        ))}
      </div>
    </main>
  );
}
