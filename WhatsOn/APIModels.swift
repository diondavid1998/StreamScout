import Foundation
import SwiftUI

// MARK: - API Config

struct API {
    static let baseURL = "https://streamscore-backend-production.up.railway.app"
    static let appName = Brand.displayName
}

// MARK: - Errors

enum APIError: LocalizedError {
    case unauthorized
    case clientError(Int, String?)
    case serverError(Int)
    case decodingError
    case networkError(Error)

    var errorDescription: String? {
        switch self {
        case .unauthorized:          return "Session expired — please sign in again."
        case .clientError(let c, let message):
            return message?.isEmpty == false ? message : "Request failed (\(c))."
        case .serverError(let c):    return "Server error (\(c))."
        case .decodingError:         return "Unexpected server response."
        case .networkError(let e):   return e.localizedDescription
        }
    }
}

// MARK: - Auth

struct AuthResponse: Codable {
    let token: String?
    let error: String?
}

// MARK: - Platforms

struct PlatformResponse: Codable {
    let platforms: [String]
    let languages: [String]?
}

struct GenericResponse: Codable {
    let success: Bool?
    let ok: Bool?
    let error: String?
}

// MARK: - Catalog

enum MediaKind: String, Codable {
    case movie, series

    var accent: Color {
        switch self {
        case .movie:  Color(hex: "#FF453A")   // systemRed
        case .series: Color(hex: "#0A84FF")   // systemBlue
        }
    }

    var label: String {
        switch self {
        case .movie:  "Movie"
        case .series: "TV Show"
        }
    }

    var symbol: String {
        switch self {
        case .movie:  "film.fill"
        case .series: "tv.fill"
        }
    }
}

struct CatalogItem: Identifiable {
    var id: String
    var title: String
    var mediaType: String?
    var year: Int?
    var overview: String?
    var posterUrl: String?
    var genres: [String]?
    var availableOn: [String]?
    var popularity: Double?
    var tmdbRating: Double?
    var tmdbVotes: Int?
    var imdbRating: String?
    var imdbVotes: String?
    var rottenTomatoesRating: String?
    var rottenTomatoesAudience: String?
    var metacriticRating: String?
    var metacriticAudience: String?

    /// Media classification derived from the backend's mediaType string.
    var kind: MediaKind { mediaType == "tv" ? .series : .movie }
}

extension CatalogItem: Decodable {
    enum CodingKeys: String, CodingKey {
        case id, title, mediaType, year, overview, posterUrl, genres, availableOn
        case popularity, tmdbRating, tmdbVotes
        // Backend nests all third-party ratings inside a "ratings" object
        case ratings
    }

    // Keys inside the nested "ratings" object sent by the backend
    private enum RatingKeys: String, CodingKey {
        case tmdb
        case imdb
        case rottenTomatoes
        case metacritic
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // id can arrive as Int or String depending on TMDB source
        if let s = try? c.decode(String.self, forKey: .id) {
            id = s
        } else if let i = try? c.decode(Int.self, forKey: .id) {
            id = String(i)
        } else {
            id = UUID().uuidString
        }
        title       = (try? c.decode(String.self,   forKey: .title))   ?? "Unknown Title"
        mediaType   = try? c.decode(String.self,    forKey: .mediaType)
        year        = try? c.decode(Int.self,        forKey: .year)
        overview    = try? c.decode(String.self,    forKey: .overview)
        posterUrl   = try? c.decode(String.self,    forKey: .posterUrl)
        genres      = try? c.decode([String].self,  forKey: .genres)
        availableOn = try? c.decode([String].self,  forKey: .availableOn)
        popularity  = try? c.decode(Double.self,    forKey: .popularity)
        tmdbVotes   = try? c.decode(Int.self,       forKey: .tmdbVotes)

        // Decode the nested ratings container sent by the backend
        let r = try? c.nestedContainer(keyedBy: RatingKeys.self, forKey: .ratings)
        // tmdbRating may be inside "ratings.tmdb" (new) or at top level "tmdbRating" (fallback)
        tmdbRating = (try? r?.decode(Double.self, forKey: .tmdb))
            ?? (try? c.decode(Double.self, forKey: .tmdbRating))

        // Scrub empty strings – treat them as absent (backend stores "" for unhydrated items)
        let rawImdb = try? r?.decode(String.self, forKey: .imdb)
        imdbRating = (rawImdb?.isEmpty == false && rawImdb != "N/A") ? rawImdb : nil
        imdbVotes = nil  // not currently returned by backend

        let rawRT = try? r?.decode(String.self, forKey: .rottenTomatoes)
        rottenTomatoesRating = (rawRT?.isEmpty == false && rawRT != "N/A") ? rawRT : nil
        rottenTomatoesAudience = nil  // not currently returned by backend

        let rawMeta = try? r?.decode(String.self, forKey: .metacritic)
        metacriticRating = (rawMeta?.isEmpty == false && rawMeta != "N/A") ? rawMeta : nil
        metacriticAudience = nil  // not currently returned by backend
    }
}

struct CatalogMeta: Codable {
    let page: Int?
    let totalPages: Int?
    let resultCount: Int?
    let visibleCount: Int?
    let platformCount: Int?
    let lastUpdatedAt: String?
    let refreshing: Bool?
    let languages: [String]?
}

struct CatalogResponse: Decodable {
    let items: [CatalogItem]?   // backend returns "items"
    let movies: [CatalogItem]?  // fallback key
    let meta: CatalogMeta?
    let error: String?

    var catalog: [CatalogItem] { items ?? movies ?? [] }
}

// MARK: - Title Details

struct CastMember: Decodable, Identifiable {
    let id: Int
    let name: String
    let character: String
    let profileUrl: String?
}

struct TitleDetails: Decodable {
    let tmdbId: Int?
    let title: String?
    let overview: String?
    let tagline: String?
    let posterUrl: String?
    let backdropUrl: String?
    let releaseDate: String?
    let runtime: Int?
    let numberOfSeasons: Int?
    let genres: [String]?
    let directors: [String]?
    let cast: [CastMember]?
}

// MARK: - Watched List

struct WatchedItem: Decodable, Identifiable {
    var id: String { itemId }
    let itemId: String
    let mediaType: String?
    let title: String?
    let posterUrl: String?
}

struct WatchedListResponse: Decodable {
    let items: [WatchedItem]?
}

struct ToggleWatchedResponse: Decodable {
    let success: Bool?
    let watched: Bool?
    let error: String?
}

// MARK: - Watchlist (Letterboxd)

struct WatchlistItem: Decodable, Identifiable {
    var id: String { itemId }
    let itemId: String
    let mediaType: String?
    let title: String?
    let posterUrl: String?
}

struct WatchlistResponse: Decodable {
    let items: [WatchlistItem]?
}

// MARK: - Currently Watching

/// One followed series. `scheduleMessage` is composed server-side — the day of
/// the week is derived from TMDB's next air date in US Central, and doing it in
/// one place is what keeps the web app and this one saying the same sentence.
struct CurrentlyWatchingItem: Decodable, Identifiable {
    var id: String { itemId }
    let itemId: String
    let title: String?
    let posterUrl: String?
    /// airing, all_out, ended, or unknown when the show has never been fetched.
    let state: String?
    let scheduleMessage: String?
    /// Something aired since this user last said they were caught up.
    let hasNewEpisode: Bool?
}

extension CurrentlyWatchingItem {
    /// A copy with the new-episode flag cleared, so the dot can disappear the
    /// moment "Caught up" is tapped rather than after the round trip.
    func markedCaughtUp() -> CurrentlyWatchingItem {
        CurrentlyWatchingItem(
            itemId: itemId,
            title: title,
            posterUrl: posterUrl,
            state: state,
            scheduleMessage: scheduleMessage,
            hasNewEpisode: false
        )
    }
}

struct CurrentlyWatchingResponse: Decodable {
    let items: [CurrentlyWatchingItem]?
}

// MARK: - Letterboxd diary & analytics

/// What the server made of an uploaded export. Every count here comes from the
/// CSVs themselves, so it is available the instant the upload finishes.
struct DiaryImportResponse: Decodable {
    let success: Bool?
    let films: Int?
    let viewings: Int?
    let rated: Int?
    let dated: Int?
    let watchlist: Int?
    let hasDiary: Bool?
    let files: [DiaryImportFile]?
    let error: String?
}

struct DiaryImportFile: Decodable, Identifiable {
    var id: String { name }
    let name: String
    let kind: String
    let rows: Int
}

struct AnalyticsCoverage: Decodable {
    let films: Int
    let resolved: Int
    /// Films still worth looking up. Excludes the ones the film database has
    /// already been asked about and had nothing for.
    let pending: Int
    /// Films that were looked up and could not be matched. Optional so a
    /// payload from an older server still decodes.
    let unmatched: Int?
}

struct AnalyticsSummary: Decodable {
    let films: Int
    let viewings: Int
    let rated: Int
    let meanRating: Double?
    let crowdMean: Double?
    let tasteOffset: Double?
    let comparedOn: Int?
    let runtimeMinutes: Int
    let firstWatched: String?
    let lastWatched: String?
}

struct RatingBucket: Decodable, Identifiable {
    var id: Double { rating }
    let rating: Double
    let films: Int
}

struct RatingYear: Decodable, Identifiable {
    var id: String { year }
    let year: String
    let films: Int
    let meanRating: Double?
}

struct TitleDelta: Decodable, Identifiable {
    var id: String { "\(name)-\(year ?? 0)" }
    let name: String
    let year: Int?
    let rating: Double
    let crowd: Double?
    let delta: Double
}

struct AnalyticsRating: Decodable {
    let histogram: [RatingBucket]
    let mode: RatingBucket?
    let byYear: [RatingYear]
    let hottestTakes: HottestTakes
}

struct HottestTakes: Decodable {
    let above: [TitleDelta]
    let below: [TitleDelta]
}

struct DecadeBucket: Decodable, Identifiable {
    var id: String { decade }
    let decade: String
    let films: Int
    let meanRating: Double?
}

struct LanguageBucket: Decodable, Identifiable {
    var id: String { code }
    let code: String
    let films: Int
}

struct AnalyticsEras: Decodable {
    let decades: [DecadeBucket]
    let lagYearsMedian: Double?
    let languages: [LanguageBucket]
}

struct TagBucket: Decodable, Identifiable {
    var id: String { tag }
    let tag: String
    let films: Int
}

/// Tags — what survives without a watch date and without a rewatch count.
struct AnalyticsCollection: Decodable {
    let topTags: [TagBucket]
}

/// One entry in a ranked dimension — a director, actor, genre, language,
/// decade or tag, with the films behind it.
///
/// `label` is what to show: for most dimensions it equals `name`, but a language
/// arrives as a code the server has already turned into "Japanese".
struct BreakdownEntry: Decodable, Identifiable {
    var id: String { name }
    let name: String
    let label: String
    let films: Int
    let rated: Int
    let meanRating: Double?
    let crowdMean: Double?
    let delta: Double?
}

/// The focused dimension: its ranking, and the two ends of it by rating.
struct AnalyticsBreakdown: Decodable {
    let id: String
    let title: String
    let unit: String?
    /// The filter this dimension's entries set when tapped, so drilling in is
    /// just adding a filter. Nil on dimensions that aren't rankable.
    let filterKey: String?
    let total: Int
    let entries: [BreakdownEntry]
    let best: [BreakdownEntry]
    let worst: [BreakdownEntry]
    let needsLookup: Bool
}

/// A lens the page can be pointed at. Named by the server so the two can't drift.
struct AnalyticsDimension: Decodable, Identifiable {
    let id: String
    let title: String
    let needsLookup: Bool
}

/// An applied filter, already labelled for a removable chip.
struct AppliedFilter: Decodable, Identifiable, Equatable {
    var id: String { "\(key)=\(value)" }
    let key: String
    let value: String
    let label: String
}

/// One option in a filter picker, with how many films it would leave.
struct FilterOption: Decodable, Identifiable, Equatable {
    var id: String { value }
    let value: String
    let label: String
    let films: Int
}

struct AvailableFilters: Decodable {
    let languages: [FilterOption]
    let genres: [FilterOption]
    let decades: [FilterOption]
    let directors: [FilterOption]
    let cast: [FilterOption]
    let tags: [FilterOption]

    func options(for key: String) -> [FilterOption] {
        switch key {
        case "language": return languages
        case "genre":    return genres
        case "decade":   return decades
        case "director": return directors
        case "actor":    return cast
        case "tag":      return tags
        default:         return []
        }
    }
}

struct AnalyticsFilters: Decodable {
    let applied: [AppliedFilter]
    let available: AvailableFilters
}

/// What the filters left, against what the library holds.
struct AnalyticsScope: Decodable {
    let films: Int
    let filmsTotal: Int
    let filtered: Bool
}

/// The top of one dimension, for the overview to point at the rest.
struct AnalyticsHighlight: Decodable, Identifiable {
    let id: String
    let title: String
    let entries: [BreakdownEntry]
}

struct AnalyticsResponse: Decodable {
    let dimension: String
    let dimensions: [AnalyticsDimension]
    let filters: AnalyticsFilters
    let scope: AnalyticsScope
    let coverage: AnalyticsCoverage
    let summary: AnalyticsSummary
    let breakdown: AnalyticsBreakdown?
    let rating: AnalyticsRating?
    let eras: AnalyticsEras?
    let collection: AnalyticsCollection?
    let highlights: [AnalyticsHighlight]?
}

struct ResolveResponse: Decodable {
    let resolved: Int?
    let failed: Int?
    let pending: Int?
}

struct LetterboxdPreviewResponse: Decodable {
    let importType: String?
    let count: Int?
    let items: [[String: AnyCodable]]?
}

// Simple wrapper so we can decode heterogeneous JSON values
struct AnyCodable: Decodable {
    let value: Any
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let s = try? c.decode(String.self) { value = s }
        else if let i = try? c.decode(Int.self) { value = i }
        else { value = "" }
    }
}

struct LetterboxdPreviewItem: Decodable {
    let name: String
    let year: Int
}

struct LetterboxdPreviewResult: Decodable {
    let importType: String?
    let count: Int?
    let items: [LetterboxdPreviewItem]
}

struct LetterboxdImportResponse: Decodable {
    let matched: Int?
    let notFound: Int?
    let processed: Int?
}

// Encodable wrapper for heterogeneous JSON values (used in Letterboxd batch import)
struct AnyCodableEnc: Encodable {
    private let _encode: (Encoder) throws -> Void
    init(_ value: some Encodable) { _encode = { try value.encode(to: $0) } }
    func encode(to encoder: Encoder) throws { try _encode(encoder) }
}

// MARK: - Account

struct AccountInfo: Decodable {
    let username: String?
    let email: String?
    let profilePic: String?
}

struct UpdateAccountResponse: Decodable {
    let success: Bool?
    let token: String?
    let error: String?
}

struct SimpleResponse: Decodable {
    let success: Bool?
    let error: String?
}

// MARK: - Person Filmography

struct PersonMoviesResponse: Decodable {
    let items: [CatalogItem]
}

// MARK: - Password Reset

struct ForgotPasswordResponse: Decodable {
    let success: Bool?
    let error: String?
}

// MARK: - API Service

final class APIService {
    static let shared = APIService()
    private init() {}

    func get<T: Decodable>(_ path: String, params: [String: String] = [:], token: String? = nil) async throws -> T {
        guard var components = URLComponents(string: API.baseURL + path) else {
            throw APIError.networkError(URLError(.badURL))
        }
        if !params.isEmpty {
            components.queryItems = params.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        guard let url = components.url else { throw APIError.networkError(URLError(.badURL)) }
        var req = URLRequest(url: url, timeoutInterval: 30)
        req.httpMethod = "GET"
        if let t = token, !t.isEmpty { req.setValue("Bearer \(t)", forHTTPHeaderField: "Authorization") }
        return try await perform(req)
    }

    /// `timeout` is overridable because a Letterboxd export is a few hundred
    /// kilobytes of CSV, and thirty seconds is not enough of a cellular upload.
    func post<T: Decodable>(_ path: String, body: [String: Any], token: String? = nil,
                            timeout: TimeInterval = 30) async throws -> T {
        guard let url = URL(string: API.baseURL + path) else {
            throw APIError.networkError(URLError(.badURL))
        }
        var req = URLRequest(url: url, timeoutInterval: timeout)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let t = token, !t.isEmpty { req.setValue("Bearer \(t)", forHTTPHeaderField: "Authorization") }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        return try await perform(req)
    }

    func put<T: Decodable>(_ path: String, body: [String: Any], token: String? = nil) async throws -> T {
        guard let url = URL(string: API.baseURL + path) else {
            throw APIError.networkError(URLError(.badURL))
        }
        var req = URLRequest(url: url, timeoutInterval: 30)
        req.httpMethod = "PUT"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let t = token, !t.isEmpty { req.setValue("Bearer \(t)", forHTTPHeaderField: "Authorization") }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        return try await perform(req)
    }

    func delete<T: Decodable>(_ path: String, token: String? = nil) async throws -> T {
        guard let url = URL(string: API.baseURL + path) else {
            throw APIError.networkError(URLError(.badURL))
        }
        var req = URLRequest(url: url, timeoutInterval: 30)
        req.httpMethod = "DELETE"
        if let t = token, !t.isEmpty { req.setValue("Bearer \(t)", forHTTPHeaderField: "Authorization") }
        return try await perform(req)
    }

    private func perform<T: Decodable>(_ req: URLRequest) async throws -> T {
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await URLSession.shared.data(for: req)
        } catch {
            throw APIError.networkError(error)
        }
        if let http = response as? HTTPURLResponse {
            // 403 as well as 401: the backend answers 403 for a token that fails
            // an authorization check, and treating it as a plain client error
            // left an expired session with no way back to the sign-in screen.
            if http.statusCode == 401 || http.statusCode == 403 { throw APIError.unauthorized }
            if (400...499).contains(http.statusCode) {
                let message = (try? JSONDecoder().decode(GenericResponse.self, from: data))?.error
                throw APIError.clientError(http.statusCode, message)
            }
            if http.statusCode >= 500 { throw APIError.serverError(http.statusCode) }
        }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw APIError.decodingError
        }
    }
}
