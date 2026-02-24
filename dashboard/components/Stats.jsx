'use client';

export default function Stats({ label, value, trend }) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-6">
      <div className="text-slate-500 text-sm font-medium">{label}</div>
      <div className="mt-2 text-3xl font-semibold text-slate-900">{value.toLocaleString()}</div>
      {trend && (
        <div className="mt-2 text-xs text-slate-600">{trend}</div>
      )}
    </div>
  );
}
