
'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Search, Filter, ChevronLeft, ChevronRight, Edit, Check, X, MapPin } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function OffersTable() {
    const router = useRouter();
    const searchParams = useSearchParams();

    const [offers, setOffers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });

    // Filters state
    const [search, setSearch] = useState(searchParams.get('search') || '');
    const [category, setCategory] = useState(searchParams.get('category') || 'All');
    const [source, setSource] = useState(searchParams.get('source') || 'All');
    const [status, setStatus] = useState(searchParams.get('status') || 'All');

    // Bulk Selection State
    const [selectedOffers, setSelectedOffers] = useState(new Set());

    const fetchOffers = async () => {
        setLoading(true);
        try {
            const currentPage = searchParams.get('page') || 1;
            const query = new URLSearchParams({
                page: currentPage,
                limit: 25,
                search: search,
                category: category !== 'All' ? category : '',
                source: source !== 'All' ? source : '',
                status: status !== 'All' ? status : '',
            });

            const res = await fetch(`/api/offers?${query}`);
            const data = await res.json();

            setOffers(data.offers);
            setPagination(data.pagination);
            // Reset selection on page change or filter
            setSelectedOffers(new Set());
        } catch (error) {
            console.error('Failed to fetch offers:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchOffers();
    }, [searchParams]);

    // Handle filter changes
    const handleSearch = () => {
        updateParams({ search, page: 1 });
    };

    const handleFilterChange = (key, value) => {
        if (key === 'category') setCategory(value);
        if (key === 'source') setSource(value);
        if (key === 'status') setStatus(value);
        updateParams({ [key]: value === 'All' ? '' : value, page: 1 });
    };

    const updateParams = (updates) => {
        const params = new URLSearchParams(searchParams);
        Object.entries(updates).forEach(([key, value]) => {
            if (value) {
                params.set(key, value);
            } else {
                params.delete(key);
            }
        });
        router.push(`/admin/offers?${params.toString()}`);
    };

    // Helper for status badge
    const StatusBadge = ({ status }) => {
        const styles = {
            pending: 'bg-yellow-100 text-yellow-800',
            approved: 'bg-green-100 text-green-800',
            rejected: 'bg-red-100 text-red-800',
        };
        return (
            <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status] || 'bg-gray-100'}`}>
                {status?.charAt(0).toUpperCase() + status?.slice(1)}
            </span>
        );
    };

    // Handle status update
    const handleStatusUpdate = async (id, newStatus) => {
        // Optimistic update
        setOffers(prev => prev.map(offer =>
            offer.id === id ? { ...offer, reviewStatus: newStatus } : offer
        ));

        try {
            const res = await fetch(`/api/offers/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reviewStatus: newStatus }),
            });

            if (!res.ok) throw new Error('Failed to update status');

            // Refresh count stats if needed (optional)
        } catch (error) {
            console.error('Error updating status:', error);
            // Revert on error
            fetchOffers();
            alert('Failed to update status. Please try again.');
        }
    };

    // Toggle single row selection
    const toggleSelection = (id) => {
        const newSelection = new Set(selectedOffers);
        if (newSelection.has(id)) {
            newSelection.delete(id);
        } else {
            newSelection.add(id);
        }
        setSelectedOffers(newSelection);
    };

    // Toggle all visible rows
    const toggleAll = () => {
        if (selectedOffers.size === offers.length) {
            setSelectedOffers(new Set());
        } else {
            setSelectedOffers(new Set(offers.map(o => o.id)));
        }
    };

    // Bulk Action Handler
    const handleBulkAction = async (action) => {
        if (!confirm(`Are you sure you want to ${action} ${selectedOffers.size} offers?`)) return;

        try {
            const res = await fetch('/api/offers/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ids: Array.from(selectedOffers),
                    action: action
                }),
            });

            if (!res.ok) throw new Error('Bulk action failed');

            alert(`Successfully ${action}d ${selectedOffers.size} offers!`);
            setSelectedOffers(new Set());
            fetchOffers(); // Refresh table
        } catch (error) {
            console.error('Bulk custom error:', error);
            alert('Failed to perform bulk action');
        }
    };

    return (
        <div className="bg-white rounded-lg shadow relative">
            {/* Bulk Action Bar (Floating) */}
            {selectedOffers.size > 0 && (
                <div className="absolute top-0 left-0 right-0 bg-blue-600 text-white p-4 rounded-t-lg z-10 flex justify-between items-center animate-in fade-in slide-in-from-top-4">
                    <span className="font-bold">{selectedOffers.size} Selected</span>
                    <div className="flex gap-2">
                        <button
                            onClick={() => handleBulkAction('approve')}
                            className="bg-white text-blue-600 px-3 py-1 rounded font-medium hover:bg-blue-50"
                        >
                            Approve Selected
                        </button>
                        <button
                            onClick={() => handleBulkAction('reject')}
                            className="bg-red-500 text-white px-3 py-1 rounded font-medium hover:bg-red-600"
                        >
                            Reject Selected
                        </button>
                        <button
                            onClick={() => handleBulkAction('delete')}
                            className="bg-gray-800 text-white px-3 py-1 rounded font-medium hover:bg-gray-900"
                        >
                            Delete Selected
                        </button>
                        <button
                            onClick={() => setSelectedOffers(new Set())}
                            className="text-blue-100 hover:text-white px-3"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            <div className="bg-white rounded-lg shadow">
                {/* Header Controls */}
                <div className="p-4 border-b flex flex-col md:flex-row gap-4 justify-between items-center">
                    <div className="flex gap-2 w-full md:w-auto">
                        <div className="relative">
                            <input
                                type="text"
                                placeholder="Search offers..."
                                className="pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                            />
                            <Search className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
                        </div>
                        <button
                            onClick={handleSearch}
                            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                        >
                            Search
                        </button>
                    </div>

                    <div className="flex gap-2 w-full md:w-auto overflow-x-auto">
                        <select
                            className="p-2 border rounded-lg"
                            value={category}
                            onChange={(e) => handleFilterChange('category', e.target.value)}
                        >
                            <option value="All">All Categories</option>
                            <option value="Dining">Dining</option>
                            <option value="Hotel">Hotel</option>
                            <option value="Lifestyle">Lifestyle</option>
                            <option value="Shopping">Shopping</option>
                            <option value="Travel">Travel</option>
                            <option value="Health">Health</option>
                        </select>

                        <select
                            className="p-2 border rounded-lg"
                            value={source}
                            onChange={(e) => handleFilterChange('source', e.target.value)}
                        >
                            <option value="All">All Banks</option>
                            <option value="HNB">HNB</option>
                            <option value="BOC">BOC</option>
                            <option value="NDB">NDB</option>
                            <option value="Seylan">Seylan</option>
                            <option value="Peoples">Peoples</option>
                            <option value="Sampath">Sampath</option>
                        </select>

                        <select
                            className="p-2 border rounded-lg"
                            value={status}
                            onChange={(e) => handleFilterChange('status', e.target.value)}
                        >
                            <option value="All">All Status</option>
                            <option value="pending">Pending</option>
                            <option value="approved">Approved</option>
                            <option value="rejected">Rejected</option>
                        </select>
                    </div>
                </div>

                {/* Table */}
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
                            <tr>
                                <th className="p-4 w-4">
                                    <input
                                        type="checkbox"
                                        checked={offers.length > 0 && selectedOffers.size === offers.length}
                                        onChange={toggleAll}
                                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                    />
                                </th>
                                <th className="p-4">Details</th>
                                <th className="p-4">Category</th>
                                <th className="p-4">Source</th>
                                <th className="p-4">Validity</th>
                                <th className="p-4">Status</th>
                                <th className="p-4 text-center">Locs</th>
                                <th className="p-4 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 text-sm">
                            {loading ? (
                                <tr><td colSpan="8" className="p-8 text-center text-gray-500">Loading offers...</td></tr>
                            ) : offers.length === 0 ? (
                                <tr><td colSpan="8" className="p-8 text-center text-gray-500">No offers found.</td></tr>
                            ) : (
                                offers.map((offer) => (
                                    <tr key={offer.id} className={`hover:bg-gray-50 group ${selectedOffers.has(offer.id) ? 'bg-blue-50' : ''}`}>
                                        <td className="p-4">
                                            <input
                                                type="checkbox"
                                                checked={selectedOffers.has(offer.id)}
                                                onChange={() => toggleSelection(offer.id)}
                                                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                            />
                                        </td>
                                        <td className="p-4 max-w-sm">
                                            <div className="font-medium text-gray-900 truncate" title={offer.title}>
                                                {offer.title}
                                            </div>
                                            <div className="text-xs text-gray-500 truncate">
                                                {offer.merchantName || 'Unknown Merchant'}
                                            </div>
                                            <div className="text-xs text-gray-400 font-mono mt-1">
                                                {offer.unique_id}
                                            </div>
                                        </td>
                                        <td className="p-4">
                                            <span className="px-2 py-1 bg-gray-100 rounded text-xs">
                                                {offer.category}
                                            </span>
                                        </td>
                                        <td className="p-4 font-medium text-gray-600">
                                            {offer.source}
                                        </td>
                                        <td className="p-4 text-xs">
                                            <div>{offer.validTo ? new Date(offer.validTo).toLocaleDateString() : 'N/A'}</div>
                                            {offer.validTo && (
                                                <div className={`
                        ${new Date(offer.validTo) < new Date() ? 'text-red-600' : 'text-green-600'}
                      `}>
                                                    {Math.ceil((new Date(offer.validTo) - new Date()) / (1000 * 60 * 60 * 24))} days left
                                                </div>
                                            )}
                                        </td>
                                        <td className="p-4">
                                            <StatusBadge status={offer.reviewStatus} />
                                        </td>
                                        <td className="p-4 text-center">
                                            <div className="flex items-center justify-center gap-1 text-gray-500">
                                                <MapPin size={14} />
                                                {offer.locations?.length || 0}
                                            </div>
                                        </td>
                                        <td className="p-4 text-right">
                                            <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button
                                                    onClick={() => handleStatusUpdate(offer.id, 'approved')}
                                                    className="p-1 text-green-600 hover:bg-green-50 rounded"
                                                    title="Approve"
                                                >
                                                    <Check size={16} />
                                                </button>
                                                <button
                                                    onClick={() => handleStatusUpdate(offer.id, 'rejected')}
                                                    className="p-1 text-red-600 hover:bg-red-50 rounded"
                                                    title="Reject"
                                                >
                                                    <X size={16} />
                                                </button>
                                                <Link href={`/admin/offers/${offer.id}`} className="p-1 text-blue-600 hover:bg-blue-50 rounded" title="Edit">
                                                    <Edit size={16} />
                                                </Link>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                <div className="p-4 border-t flex justify-between items-center text-sm text-gray-600">
                    <div>
                        Showing {((pagination.page - 1) * 25) + 1} to {Math.min(pagination.page * 25, pagination.total)} of {pagination.total} offers
                    </div>
                    <div className="flex gap-2">
                        <button
                            disabled={pagination.page <= 1}
                            onClick={() => updateParams({ page: pagination.page - 1 })}
                            className="p-2 border rounded hover:bg-gray-50 disabled:opacity-50"
                        >
                            <ChevronLeft size={16} />
                        </button>
                        <span className="self-center font-medium">Page {pagination.page} of {pagination.totalPages}</span>
                        <button
                            disabled={pagination.page >= pagination.totalPages}
                            onClick={() => updateParams({ page: pagination.page + 1 })}
                            className="p-2 border rounded hover:bg-gray-50 disabled:opacity-50"
                        >
                            <ChevronRight size={16} />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
