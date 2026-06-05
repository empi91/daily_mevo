export default function EmptyState() {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-6 text-center">
      <div className="text-3xl mb-3">📊</div>
      <h3 className="text-lg font-semibold text-amber-900 mb-2">
        Dane wciąż zbierane
      </h3>
      <p className="text-amber-700 text-sm max-w-md mx-auto">
        Ta stacja nie ma jeszcze wystarczającej ilości danych, aby pokazać wiarygodne wzorce
        dostępności. Zbieranie danych jest w toku — sprawdź ponownie za kilka dni.
      </p>
    </div>
  )
}
