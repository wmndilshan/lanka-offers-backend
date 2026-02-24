'use client';

import { useState, useMemo } from 'react';
import {
  Search,
  Download,
  ChevronDown,
  ChevronUp
} from 'lucide-react';

export default function OffersTable({ offers }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedBank, setSelectedBank] = useState('all');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [sortField, setSortField] = useState('merchant');
  const [sortDirection, setSortDirection] = useState('asc');

  const itemsPerPage = 50;

  // Extract unique banks and categories
  const banks = useMemo(() => {
    const uniqueBanks = [...new Set(offers.map(o => o.bank).filter(Boolean))];
    return uniqueBanks.sort();
  }, [offers]);

  const categories = useMemo(() => {
    const uniqueCategories = [...new Set(offers.map(o => o.category).filter(Boolean))];
    return uniqueCategories.sort();
  }, [offers]);

  // Filter and sort offers
  const filteredOffers = useMemo(() => {
    let filtered = offers.filter(offer => {
      const matchesSearch = !searchTerm ||
        (offer.merchant && offer.merchant.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (offer.discount && offer.discount.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchesBank = selectedBank === 'all' || offer.bank === selectedBank;
      const matchesCategory = selectedCategory === 'all' || offer.category === selectedCategory;

      return matchesSearch && matchesBank && matchesCategory;
    });

    // Sort
    filtered.sort((a, b) => {
      const aVal = a[sortField] || '';
      const bVal = b[sortField] || '';

      if (sortDirection === 'asc') {
        return aVal.toString().localeCompare(bVal.toString());
      } else {
        return bVal.toString().localeCompare(aVal.toString());
      }
    });

    return filtered;
  }, [offers, searchTerm, selectedBank, selectedCategory, sortField, sortDirection]);

  // Pagination
  const totalPages = Math.ceil(filteredOffers.length / itemsPerPage);
  const paginatedOffers = filteredOffers.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const exportToCSV = () => {
    const headers = ['Bank', 'Merchant', 'Discount', 'Category', 'Valid From', 'Valid To', 'Status'];
    const rows = filteredOffers.map(offer => [
      offer.bank || '',
      offer.merchant || '',
      offer.discount || '',
      offer.category || '',
      offer.validFrom || '',
      offer.validTo || '',
      'Active'
    ]);

    const csv = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lanka-offers-export-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  return (
    <div>
      {/* Filters Bar */}
      <div className="p-6 border-b border-slate-200">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" size={18} />
            <input
              type="text"
              placeholder="Search offers..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-sm border border-slate-200 rounded-md focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-shadow"
            />
          </div>

          <select
            value={selectedBank}
            onChange={(e) => setSelectedBank(e.target.value)}
            className="px-4 py-2 text-sm border border-slate-200 rounded-md focus:ring-2 focus:ring-brand-500 focus:border-transparent"
          >
            <option value="all">All Banks</option>
            {banks.map(bank => (
              <option key={bank} value={bank}>{bank}</option>
            ))}
          </select>

          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-4 py-2 text-sm border border-slate-200 rounded-md focus:ring-2 focus:ring-brand-500 focus:border-transparent"
          >
            <option value="all">All Categories</option>
            {categories.map(category => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>

          <button
            onClick={exportToCSV}
            className="px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-md hover:bg-slate-800 transition-colors flex items-center justify-center gap-2"
          >
            <Download size={16} />
            Export
          </button>
        </div>

        <div className="mt-4 text-xs text-slate-600">
          Showing {paginatedOffers.length} of {filteredOffers.length} offers
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-6 py-3 text-left">
                <SortButton
                  label="Bank"
                  field="bank"
                  currentField={sortField}
                  direction={sortDirection}
                  onClick={() => handleSort('bank')}
                />
              </th>
              <th className="px-6 py-3 text-left">
                <SortButton
                  label="Merchant"
                  field="merchant"
                  currentField={sortField}
                  direction={sortDirection}
                  onClick={() => handleSort('merchant')}
                />
              </th>
              <th className="px-6 py-3 text-left">
                <SortButton
                  label="Discount"
                  field="discount"
                  currentField={sortField}
                  direction={sortDirection}
                  onClick={() => handleSort('discount')}
                />
              </th>
              <th className="px-6 py-3 text-left">
                <SortButton
                  label="Category"
                  field="category"
                  currentField={sortField}
                  direction={sortDirection}
                  onClick={() => handleSort('category')}
                />
              </th>
              <th className="px-6 py-3 text-left">
                <span className="text-xs font-medium text-slate-600">Valid Period</span>
              </th>
              <th className="px-6 py-3 text-left">
                <span className="text-xs font-medium text-slate-600">Status</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {paginatedOffers.length === 0 ? (
              <tr>
                <td colSpan="6" className="px-6 py-12 text-center text-sm text-slate-500">
                  No offers found matching your criteria
                </td>
              </tr>
            ) : (
              paginatedOffers.map((offer, index) => (
                <tr key={index} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4">
                    <span className="text-xs font-medium text-slate-700">
                      {offer.bank || 'N/A'}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm font-medium text-slate-900">{offer.merchant || 'N/A'}</div>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">{offer.discount || 'N/A'}</td>
                  <td className="px-6 py-4 text-xs text-slate-600">{offer.category || 'N/A'}</td>
                  <td className="px-6 py-4 text-xs text-slate-600">
                    {offer.validFrom && offer.validTo
                      ? `${offer.validFrom} - ${offer.validTo}`
                      : 'N/A'}
                  </td>
                  <td className="px-6 py-4">
                    <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
                      <div className="w-1.5 h-1.5 rounded-full bg-green-500"></div>
                      Active
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between">
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
          >
            Previous
          </button>

          <span className="text-sm text-slate-600">
            Page {currentPage} of {totalPages}
          </span>

          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

function SortButton({ label, field, currentField, direction, onClick }) {
  const isActive = currentField === field;

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors"
    >
      {label}
      {isActive && (
        direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
      )}
    </button>
  );
}
