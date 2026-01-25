export function GpuStatusEmpty() {
  return (
    <section>
      <h2 className="text-[10px] uppercase tracking-widest text-(--muted-foreground)/50 mb-3 font-medium">
        GPU Status
      </h2>
      <p className="text-sm text-(--muted-foreground)/40">No GPU data available</p>
    </section>
  );
}
