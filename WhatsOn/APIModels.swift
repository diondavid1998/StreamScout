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

/// Watchmode's addition to the title sheet: the pros-and-cons line, who the
/// film is for, and what it costs to rent. Optional throughout — the sheet must
/// open whether or not Watchmode has anything, and its quota is small enough
/// that "nothing" is a normal answer.
struct WatchmodeExtras: Decodable {
    let pros: String?
    let cons: String?
    let verdict: String?
    let rent: WatchmodePrice?
    let buy: WatchmodePrice?
    let streamingOn: [String]?
    /// The US certificate, kept because it fills a gap: a film with no rating in
    /// TMDB's release_dates often has one here.
    let certificate: String?

    /// Whether there is anything worth drawing a section for.
    var hasContent: Bool {
        pros != nil || cons != nil || verdict != nil || rent != nil || buy != nil || certificate != nil
    }
}

struct WatchmodePrice: Decodable {
    let price: Double
    let service: String

    var label: String { String(format: "$%.2f", price) }
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
    let watchmode: WatchmodeExtras?
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
    // The server has sent countries since the country lens shipped, and nothing
    // here decoded them — so the filter existed but could only be reached by
    // drilling into the lens, never from the filter sheet.
    let countries: [FilterOption]?
    let writers: [FilterOption]?
    let cinematographers: [FilterOption]?
    let composers: [FilterOption]?
    let studios: [FilterOption]?
    let keywords: [FilterOption]?
    let certifications: [FilterOption]?

    func options(for key: String) -> [FilterOption] {
        switch key {
        case "language": return languages
        case "genre":    return genres
        case "decade":   return decades
        case "director": return directors
        case "actor":    return cast
        case "tag":      return tags
        case "country":  return countries ?? []
        case "writer":   return writers ?? []
        case "cinematographer": return cinematographers ?? []
        case "composer": return composers ?? []
        case "studio":   return studios ?? []
        case "keyword":  return keywords ?? []
        case "certification": return certifications ?? []
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
    /// Genres on two axes — watch count against mean rating — with the medians
    /// that split the plot into four quadrants.
    let quadrant: AnalyticsQuadrant?
    /// Best-rated films with their artwork. No longer drawn on the page — it
    /// feeds the share card, which is where artwork earns its place.
    let mosaic: [MosaicFilm]?
    /// The saved-for-later list against what has actually been watched.
    let watchlist: AnalyticsWatchlist?
    /// Reach, budget, certificate, franchise share and engagement.
    let profile: AnalyticsProfile?
}

/// What the film database can say about a history that the export cannot.
///
/// Each block is optional all the way down: a history whose films are not
/// looked up yet has nothing to put in most of them, and a page with fewer
/// sections reads better than one full of zeroes.
struct AnalyticsProfile: Decodable {
    let reach: ProfileDistribution?
    let scale: ProfileDistribution?
    let certifications: [ProfileBucket]?
    let franchise: ProfileFranchise?
    let engagement: ProfileEngagement?
}

struct ProfileDistribution: Decodable {
    /// Films that had a value at all — the rest of the history had nothing to
    /// place, which the page says rather than implying full coverage.
    let covered: Int
    let buckets: [ProfileBucket]
}

struct ProfileBucket: Decodable, Identifiable {
    var id: String { label }
    let label: String
    let films: Int
    let meanRating: Double?
}

struct ProfileFranchise: Decodable {
    let films: Int
    let resolved: Int
    let share: Double
}

struct ProfileEngagement: Decodable {
    let films: Int
    let liked: Int
    let reviewed: Int
    /// Liked without a score — its own kind of yes.
    let likedUnrated: Int
}

struct AnalyticsQuadrant: Decodable {
    let points: [QuadrantPoint]
    let filmsMedian: Double
    let ratingMedian: Double
}

struct QuadrantPoint: Decodable, Identifiable {
    var id: String { name }
    let name: String
    let films: Int
    let meanRating: Double
}

struct MosaicFilm: Decodable, Identifiable {
    var id: String { "\(name)|\(year ?? 0)" }
    let name: String
    let year: Int?
    let rating: Double
    let posterUrl: String?
}

struct AnalyticsWatchlist: Decodable {
    let saved: Int
    let watched: Int
    let waiting: Int
    let conversion: Double?
    let stillWaiting: [WatchlistFilm]
}

struct WatchlistFilm: Decodable, Identifiable {
    var id: String { "\(name)|\(year ?? 0)" }
    let name: String
    let year: Int?
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
        try await performRaw(req).value
    }

    /// Like `perform`, but also hands back the undecoded response bytes so a
    /// caller can persist them for an offline snapshot. Re-decoding the raw
    /// bytes on relaunch is safer than re-encoding a decoded model whose
    /// `Decodable` is hand-written (the catalog's is).
    private func performRaw<T: Decodable>(_ req: URLRequest) async throws -> (value: T, data: Data) {
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
            return (try JSONDecoder().decode(T.self, from: data), data)
        } catch {
            throw APIError.decodingError
        }
    }

    /// A GET that also returns the raw bytes, for the one caller that caches
    /// them (the Discover feed). Everything else uses the plain `get`.
    func getWithData<T: Decodable>(_ path: String, params: [String: String] = [:], token: String? = nil) async throws -> (value: T, data: Data) {
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
        return try await performRaw(req)
    }
}

// MARK: - Discovery

/// One suggestion, and the reason it is being made.
struct DiscoveryCard: Decodable, Identifiable {
    var id: String { itemId }
    let itemId: String
    let title: String
    let year: Int?
    let mediaType: String?
    let posterUrl: String?
    let overview: String?
    let genres: [String]
    let availableOn: [String]
    let ratings: CardRatings?
    /// Why this card is here. Not decoration — a recommendation nobody can
    /// interrogate is one nobody can trust, and it is what makes a bad
    /// suggestion forgivable rather than baffling.
    let because: [DiscoveryReason]
    /// 1 = matched on what the catalog already knew; 2 = crew and themes too.
    let tier: Int
    /// The deliberate slice outside the reader's usual, labelled as such.
    let exploration: Bool

    var kind: MediaKind { mediaType == "tv" ? .series : .movie }
}

struct CardRatings: Decodable {
    let imdb: String?
    let rottenTomatoes: String?
    let metacritic: String?
}

struct DiscoveryReason: Decodable, Identifiable {
    var id: String { "\(kind)-\(value)" }
    let kind: String
    let value: String
    let detail: String?
}

/// What the queue was built from, so the screen can be honest about it.
struct DiscoveryProfile: Decodable {
    /// "crowd", "blended" or "diary".
    let basis: String
    let ratedFilms: Int
    let films: Int
    let confidence: String

    var isPersonal: Bool { basis != "crowd" }
}

struct DiscoveryResponse: Decodable {
    let cards: [DiscoveryCard]
    let profile: DiscoveryProfile
    let exhausted: Bool
}

// MARK: - Offline snapshots

/// The last successful response for one screen, kept on disk so it shows
/// instantly on a cold launch and still reads on a plane.
///
/// It is a cache, not a source of truth: a live fetch overwrites it, and it is
/// only ever restored for the exact view it was captured under, tracked by a
/// signature stored alongside the bytes. `Caches` is the right home — every byte
/// here is re-fetchable, so the system is welcome to reclaim it under pressure.
struct JSONSnapshot {
    /// Distinguishes one screen's files from another's.
    let name: String

    private var dir: URL? {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
    }
    private var dataURL: URL? { dir?.appendingPathComponent("whatson-\(name).json") }
    private var sigURL: URL? { dir?.appendingPathComponent("whatson-\(name).sig") }

    func save(_ data: Data, signature: String) {
        guard let d = dataURL, let s = sigURL else { return }
        try? data.write(to: d, options: .atomic)
        try? Data(signature.utf8).write(to: s, options: .atomic)
    }

    /// The stored bytes, but only when they were captured under `signature`.
    func load(signature: String) -> Data? {
        guard let d = dataURL, let s = sigURL,
              let sig = try? Data(contentsOf: s),
              String(decoding: sig, as: UTF8.self) == signature else { return nil }
        return try? Data(contentsOf: d)
    }

    func clear() {
        if let d = dataURL { try? FileManager.default.removeItem(at: d) }
        if let s = sigURL { try? FileManager.default.removeItem(at: s) }
    }
}

/// The default Discover response — same services, sort and media type.
enum FeedSnapshot {
    private static let store = JSONSnapshot(name: "feed")
    static func save(_ data: Data, signature: String) { store.save(data, signature: signature) }
    static func load(signature: String) -> Data? { store.load(signature: signature) }
    static func clear() { store.clear() }
}

/// The analytics page, keyed by the lens and filters it was captured under.
///
/// Worth caching more than the feed is: an imported history changes only when
/// the user imports again, yet the page was re-fetched from scratch on every
/// cold launch. Restoring it means the numbers are on screen before the request
/// is sent, and are still there when it cannot be.
enum AnalyticsSnapshot {
    private static let store = JSONSnapshot(name: "analytics")

    /// The lens and its filters, ordered so the same view always signs the same.
    static func signature(dimension: String, filters: [String: String]) -> String {
        let parts = filters.keys.sorted().map { "\($0)=\(filters[$0] ?? "")" }
        return ([dimension] + parts).joined(separator: "&")
    }

    static func save(_ data: Data, signature: String) { store.save(data, signature: signature) }
    static func load(signature: String) -> Data? { store.load(signature: signature) }
    static func clear() { store.clear() }
}
