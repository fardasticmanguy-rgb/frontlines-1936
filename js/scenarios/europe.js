import { MAP_HEIGHT, MAP_WIDTH, NATIONS, NEUTRAL, applyRoster } from "../config.js";
import { clipHalfPlane, distanceSquared, pointInPolygon } from "../geometry.js";

export const EUROPE_ROSTER = [
  { name: "GERMANY", color: "#6e7378", flag: "germany", trait: "blitz" },
  { name: "BRITAIN", color: "#c45f73", flag: "uk", trait: "industry" },
  { name: "FRANCE", color: "#4b77ad", flag: "france", trait: "fortress" },
  { name: "USSR", color: "#8e2f2a", flag: "ussr", trait: "winter" },
  { name: "ITALY", color: "#5f8f4a", flag: "italy", trait: "rough" },
  { name: "POLAND", color: "#9c7cc0", flag: "poland", trait: "mobilization" },
  { name: "SPAIN", color: "#cfa63c", flag: "spain", trait: "rough" },
  { name: "TURKEY", color: "#c9773a", flag: "turkey", trait: "fortress" },
];

const OWNERS = { GER: 0, UK: 1, FRA: 2, SOV: 3, ITA: 4, POL: 5, SPA: 6, TUR: 7 };
const FIRST_TURN = 43;
const GARRISON_BONUS = { FRA: 2, POL: 2, UK: 1 };
const INDUSTRY = [10, 12, 12, 12, 8, 8, 6, 6];
const FACTIONS = [0, 1, 1, NEUTRAL, 0, 1, NEUTRAL, NEUTRAL];
const FACTION_NAMES = {
  0: { name: "AXIS", core: [0, 4] },
  1: { name: "ALLIES", core: [1, 2] },
};

const LON0 = -11;
const LON1 = 45.5;
const LAT0 = 34.5;
const LAT1 = 64.5;

const PROVINCES = [
  ["Berlin", 13.4, 52.52, "GER", 0, "C F1"],
  ["Hamburg", 10.0, 53.55, "GER", 0, "c"],
  ["Bremen", 8.8, 53.08, "GER", 0, ""],
  ["Hanover", 9.73, 52.37, "GER", 0, ""],
  ["Essen", 7.01, 51.45, "GER", 0, "c F1"],
  ["Frankfurt", 8.68, 50.11, "GER", 1, "c"],
  ["Stuttgart", 9.18, 48.78, "GER", 1, ""],
  ["Munich", 11.58, 48.14, "GER", 0, "c"],
  ["Nuremberg", 11.08, 49.45, "GER", 1, ""],
  ["Leipzig", 12.37, 51.34, "GER", 0, "c F1"],
  ["Dresden", 13.74, 51.05, "GER", 2, ""],
  ["Stettin", 14.55, 53.43, "GER", 0, ""],
  ["Rostock", 12.2, 53.95, "GER", 0, ""],
  ["Breslau", 17.03, 51.11, "GER", 0, "c T5"],
  ["Königsberg", 20.5, 54.7, "GER", 1, "c T5"],
  ["Vienna", 16.37, 48.21, "GER", 0, "c"],
  ["Innsbruck", 11.4, 47.27, "GER", 2, ""],
  ["Graz", 15.44, 47.07, "GER", 2, ""],
  ["Prague", 14.42, 50.08, "GER", 0, "c"],
  ["Brno", 16.6, 49.2, "GER", 1, ""],

  ["London", -0.13, 51.5, "UK", 0, "C F1"],
  ["Birmingham", -1.9, 52.48, "UK", 0, "c F2"],
  ["Manchester", -2.24, 53.48, "UK", 0, "c F1"],
  ["Newcastle", -1.6, 54.97, "UK", 0, ""],
  ["Glasgow", -4.25, 55.86, "UK", 0, "c"],
  ["Edinburgh", -3.19, 55.95, "UK", 1, ""],
  ["Inverness", -4.22, 57.48, "UK", 2, ""],
  ["Aberdeen", -2.1, 57.15, "UK", 1, ""],
  ["Cardiff", -3.18, 51.48, "UK", 1, ""],
  ["Plymouth", -4.14, 50.37, "UK", 0, ""],
  ["Norwich", 1.3, 52.63, "UK", 0, ""],
  ["Belfast", -5.93, 54.6, "UK", 0, ""],

  ["Paris", 2.35, 48.86, "FRA", 0, "C F1"],
  ["Lille", 3.06, 50.63, "FRA", 0, "c F1 f"],
  ["Calais", 1.86, 50.95, "FRA", 0, ""],
  ["Rouen", 1.1, 49.44, "FRA", 0, ""],
  ["Brest", -4.49, 48.39, "FRA", 0, ""],
  ["Nantes", -1.55, 47.22, "FRA", 0, ""],
  ["Orléans", 1.9, 47.9, "FRA", 0, ""],
  ["Bordeaux", -0.58, 44.84, "FRA", 1, "c"],
  ["Toulouse", 1.44, 43.6, "FRA", 0, ""],
  ["Marseille", 5.37, 43.3, "FRA", 0, "c"],
  ["Lyon", 4.83, 45.76, "FRA", 0, "c"],
  ["Strasbourg", 7.75, 48.58, "FRA", 1, "f T5"],
  ["Metz", 6.18, 49.12, "FRA", 0, "f T5"],
  ["Dijon", 5.04, 47.32, "FRA", 0, ""],
  ["Clermont", 3.08, 45.78, "FRA", 2, ""],
  ["Grenoble", 5.72, 45.19, "FRA", 2, ""],
  ["Nice", 7.26, 43.7, "FRA", 2, ""],
  ["Ajaccio", 8.74, 41.92, "FRA", 2, ""],
  ["Aleppo", 37.16, 36.2, "FRA", 0, "c"],

  ["Moscow", 37.62, 55.75, "SOV", 0, "C F1"],
  ["Leningrad", 30.31, 59.94, "SOV", 0, "c F1"],
  ["Kharkov", 36.23, 49.99, "SOV", 0, "c F1"],
  ["Kiev", 30.52, 50.45, "SOV", 0, "c"],
  ["Minsk", 27.56, 53.9, "SOV", 1, ""],
  ["Smolensk", 32.05, 54.78, "SOV", 1, ""],
  ["Odessa", 30.73, 46.48, "SOV", 0, ""],
  ["Rostov", 39.7, 47.23, "SOV", 0, "c"],
  ["Stalingrad", 44.5, 48.7, "SOV", 0, "c"],
  ["Voronezh", 39.2, 51.67, "SOV", 0, ""],
  ["Kursk", 36.19, 51.73, "SOV", 0, ""],
  ["Dnepropetrovsk", 35.04, 48.46, "SOV", 0, ""],
  ["Sevastopol", 33.52, 44.6, "SOV", 2, ""],
  ["Bryansk", 34.36, 53.25, "SOV", 1, ""],
  ["Novgorod", 31.27, 58.52, "SOV", 1, ""],
  ["Pskov", 28.33, 57.82, "SOV", 1, ""],
  ["Zhitomir", 28.66, 50.25, "SOV", 1, ""],
  ["Vinnitsa", 28.47, 49.23, "SOV", 0, ""],
  ["Vologda", 39.9, 59.22, "SOV", 1, ""],
  ["Yaroslavl", 39.87, 57.63, "SOV", 1, ""],
  ["Gorky", 44.0, 56.33, "SOV", 1, "c"],
  ["Petrozavodsk", 34.35, 61.8, "SOV", 1, ""],
  ["Tula", 37.62, 54.19, "SOV", 0, ""],
  ["Kalinin", 35.9, 56.86, "SOV", 1, ""],
  ["Krasnodar", 38.98, 45.04, "SOV", 0, ""],
  ["Tbilisi", 44.8, 41.7, "SOV", 2, "c"],
  ["Tambov", 41.45, 52.72, "SOV", 0, ""],

  ["Rome", 12.5, 41.9, "ITA", 0, "C"],
  ["Milan", 9.19, 45.46, "ITA", 0, "c F2"],
  ["Turin", 7.68, 45.07, "ITA", 2, "c F1"],
  ["Genoa", 8.93, 44.41, "ITA", 2, ""],
  ["Venice", 12.33, 45.44, "ITA", 0, "c"],
  ["Bologna", 11.34, 44.49, "ITA", 0, ""],
  ["Florence", 11.25, 43.77, "ITA", 2, ""],
  ["Naples", 14.27, 40.85, "ITA", 0, "c"],
  ["Bari", 16.87, 41.12, "ITA", 0, ""],
  ["Pescara", 14.21, 42.46, "ITA", 2, ""],
  ["Reggio", 16.1, 38.9, "ITA", 2, ""],
  ["Palermo", 13.9, 37.6, "ITA", 2, "c"],
  ["Cagliari", 9.0, 40.0, "ITA", 2, ""],
  ["Trieste", 13.77, 45.65, "ITA", 2, ""],
  ["Bolzano", 11.35, 46.5, "ITA", 2, ""],
  ["Tirana", 19.82, 41.33, "ITA", 2, ""],

  ["Warsaw", 21.01, 52.23, "POL", 0, "C"],
  ["Kraków", 19.94, 50.06, "POL", 2, "c"],
  ["Łódź", 19.46, 51.76, "POL", 0, ""],
  ["Poznań", 16.93, 52.41, "POL", 0, "T4"],
  ["Gdynia", 18.53, 54.3, "POL", 1, ""],
  ["Lwów", 24.03, 49.84, "POL", 0, "c"],
  ["Wilno", 25.28, 54.69, "POL", 1, ""],
  ["Białystok", 23.16, 53.13, "POL", 1, ""],
  ["Lublin", 22.57, 51.25, "POL", 0, ""],
  ["Pinsk", 26.1, 52.1, "POL", 1, ""],

  ["Madrid", -3.7, 40.42, "SPA", 0, "C"],
  ["Barcelona", 2.17, 41.39, "SPA", 0, "c F1"],
  ["Valencia", -0.38, 39.47, "SPA", 0, ""],
  ["Seville", -5.98, 37.39, "SPA", 0, "c"],
  ["Bilbao", -2.93, 43.26, "SPA", 2, ""],
  ["Zaragoza", -0.89, 41.65, "SPA", 0, ""],
  ["Málaga", -4.42, 36.9, "SPA", 2, ""],
  ["A Coruña", -8.2, 43.1, "SPA", 2, ""],
  ["Valladolid", -4.72, 41.65, "SPA", 0, ""],
  ["Badajoz", -6.97, 38.88, "SPA", 0, ""],
  ["Murcia", -1.13, 37.98, "SPA", 2, ""],

  ["Ankara", 32.86, 39.93, "TUR", 0, "C"],
  ["Istanbul", 28.98, 41.01, "TUR", 0, "c"],
  ["Izmir", 27.14, 38.42, "TUR", 0, "c"],
  ["Bursa", 29.06, 40.18, "TUR", 2, ""],
  ["Edirne", 26.56, 41.67, "TUR", 0, ""],
  ["Samsun", 36.33, 41.29, "TUR", 1, ""],
  ["Konya", 32.48, 37.87, "TUR", 0, ""],
  ["Antalya", 30.7, 37.0, "TUR", 2, ""],
  ["Adana", 35.32, 37.0, "TUR", 0, ""],
  ["Kayseri", 35.48, 38.73, "TUR", 2, ""],
  ["Trabzon", 39.72, 41.0, "TUR", 2, ""],
  ["Erzurum", 41.27, 39.9, "TUR", 2, ""],
  ["Diyarbakır", 40.22, 37.91, "TUR", 2, ""],

  ["Dublin", -6.26, 53.35, "Ireland", 0, "c"],
  ["Cork", -8.47, 51.9, "Ireland", 0, ""],
  ["Galway", -9.05, 53.27, "Ireland", 1, ""],
  ["Lisbon", -9.14, 38.72, "Portugal", 0, "c"],
  ["Porto", -8.61, 41.15, "Portugal", 2, ""],
  ["Amsterdam", 4.9, 52.37, "Netherlands", 0, "c"],
  ["Groningen", 6.57, 53.22, "Netherlands", 0, ""],
  ["Brussels", 4.35, 50.85, "Belgium", 0, "c"],
  ["Liège", 5.57, 50.4, "Belgium", 1, "f"],
  ["Bern", 7.45, 46.95, "Switzerland", 2, "c T6"],
  ["Zurich", 8.54, 47.37, "Switzerland", 2, "T5"],
  ["Copenhagen", 11.95, 55.5, "Denmark", 0, "c"],
  ["Aarhus", 9.6, 56.15, "Denmark", 0, ""],
  ["Oslo", 10.75, 59.91, "Norway", 1, "c"],
  ["Bergen", 5.6, 60.6, "Norway", 2, ""],
  ["Trondheim", 10.4, 63.43, "Norway", 2, ""],
  ["Kristiansand", 8.0, 58.4, "Norway", 2, ""],
  ["Stockholm", 18.07, 59.33, "Sweden", 1, "c"],
  ["Gothenburg", 12.4, 57.5, "Sweden", 0, ""],
  ["Malmö", 13.6, 55.9, "Sweden", 0, ""],
  ["Kalmar", 15.6, 56.9, "Sweden", 1, ""],
  ["Sundsvall", 17.0, 62.4, "Sweden", 1, ""],
  ["Östersund", 14.64, 63.18, "Sweden", 2, ""],
  ["Karlstad", 13.5, 59.6, "Sweden", 1, ""],
  ["Helsinki", 24.94, 60.17, "Finland", 0, "c"],
  ["Viipuri", 28.75, 60.71, "Finland", 1, "f T5"],
  ["Tampere", 23.76, 61.5, "Finland", 1, ""],
  ["Kuopio", 27.68, 62.89, "Finland", 1, ""],
  ["Vaasa", 22.4, 63.3, "Finland", 1, ""],
  ["Tallinn", 25.2, 59.1, "Estonia", 0, "c"],
  ["Riga", 24.4, 56.95, "Latvia", 0, "c"],
  ["Kaunas", 23.9, 55.1, "Lithuania", 0, "c"],
  ["Banská Bystrica", 19.15, 48.73, "Slovakia", 2, ""],
  ["Košice", 21.26, 48.72, "Slovakia", 2, ""],
  ["Budapest", 19.04, 47.5, "Hungary", 0, "c"],
  ["Debrecen", 21.63, 47.53, "Hungary", 0, ""],
  ["Pécs", 18.23, 46.07, "Hungary", 0, ""],
  ["Bucharest", 26.1, 44.43, "Romania", 0, "c F1"],
  ["Cluj", 23.6, 46.77, "Romania", 2, ""],
  ["Iași", 27.6, 47.16, "Romania", 0, ""],
  ["Constanța", 28.3, 44.4, "Romania", 0, ""],
  ["Timișoara", 21.23, 45.75, "Romania", 0, ""],
  ["Chișinău", 28.86, 47.0, "Romania", 0, ""],
  ["Brașov", 25.6, 45.65, "Romania", 2, ""],
  ["Belgrade", 20.46, 44.79, "Yugoslavia", 0, "c"],
  ["Zagreb", 15.98, 45.81, "Yugoslavia", 1, ""],
  ["Sarajevo", 18.41, 43.86, "Yugoslavia", 2, ""],
  ["Skopje", 21.43, 41.99, "Yugoslavia", 2, ""],
  ["Split", 16.44, 43.51, "Yugoslavia", 2, ""],
  ["Ljubljana", 14.5, 46.05, "Yugoslavia", 2, ""],
  ["Sofia", 23.32, 42.7, "Bulgaria", 2, "c"],
  ["Varna", 27.5, 43.21, "Bulgaria", 0, ""],
  ["Plovdiv", 24.75, 42.15, "Bulgaria", 1, ""],
  ["Athens", 23.73, 37.98, "Greece", 0, "c"],
  ["Thessaloniki", 22.94, 40.64, "Greece", 2, ""],
  ["Ioannina", 20.85, 39.66, "Greece", 2, ""],
  ["Patras", 21.9, 37.6, "Greece", 2, ""],
  ["Mosul", 43.13, 36.34, "Iraq", 0, ""],
];

const LINKS = [
  ["London", "Calais"],
  ["Glasgow", "Belfast"],
  ["Manchester", "Dublin"],
  ["Copenhagen", "Aarhus"],
  ["Copenhagen", "Malmö"],
  ["Palermo", "Reggio"],
  ["Ajaccio", "Nice"],
  ["Ajaccio", "Cagliari"],
  ["Tallinn", "Helsinki"],
  ["Istanbul", "Bursa"],
  ["Sevastopol", "Krasnodar"],
  ["Stockholm", "Vaasa"],
];

const MAINLAND = [
  [-5.6, 36.0],
  [-6.3, 36.5],
  [-7.0, 37.2],
  [-7.9, 37.0],
  [-8.9, 37.0],
  [-8.8, 38.0],
  [-9.5, 38.7],
  [-9.4, 39.4],
  [-8.8, 40.6],
  [-8.7, 41.2],
  [-8.9, 42.2],
  [-9.3, 42.9],
  [-8.4, 43.4],
  [-7.7, 43.75],
  [-5.7, 43.6],
  [-3.8, 43.5],
  [-2.9, 43.4],
  [-2.0, 43.3],
  [-1.6, 43.5],
  [-1.2, 44.6],
  [-1.2, 45.6],
  [-1.2, 46.2],
  [-2.2, 47.3],
  [-3.4, 47.7],
  [-4.8, 48.4],
  [-3.5, 48.85],
  [-2.8, 48.6],
  [-2.0, 48.7],
  [-1.5, 48.7],
  [-1.9, 49.7],
  [-1.6, 49.65],
  [-0.3, 49.3],
  [0.1, 49.5],
  [1.1, 49.95],
  [1.6, 50.7],
  [1.85, 50.95],
  [2.4, 51.05],
  [2.9, 51.2],
  [3.6, 51.5],
  [4.1, 52.0],
  [4.6, 52.6],
  [4.75, 52.95],
  [5.4, 53.2],
  [6.8, 53.4],
  [7.2, 53.4],
  [8.1, 53.6],
  [8.7, 53.9],
  [8.9, 54.5],
  [8.6, 55.0],
  [8.4, 55.5],
  [8.1, 56.5],
  [8.6, 57.1],
  [10.0, 57.6],
  [10.6, 57.75],
  [10.4, 57.2],
  [10.6, 56.2],
  [10.0, 55.7],
  [9.8, 55.5],
  [10.0, 55.0],
  [10.2, 54.4],
  [10.9, 54.0],
  [12.1, 54.2],
  [13.6, 54.6],
  [14.3, 53.9],
  [15.6, 54.2],
  [17.5, 54.8],
  [18.7, 54.4],
  [19.6, 54.45],
  [19.9, 54.6],
  [21.1, 55.0],
  [21.1, 55.7],
  [21.0, 56.5],
  [21.5, 57.4],
  [22.6, 57.75],
  [23.5, 57.1],
  [24.1, 57.0],
  [24.4, 57.9],
  [24.5, 58.4],
  [23.5, 58.6],
  [23.5, 59.2],
  [24.7, 59.5],
  [26.5, 59.55],
  [28.0, 59.4],
  [29.1, 59.9],
  [30.2, 59.9],
  [29.5, 60.2],
  [28.7, 60.6],
  [26.9, 60.4],
  [24.9, 60.15],
  [23.0, 59.8],
  [22.2, 60.4],
  [21.4, 61.0],
  [21.5, 62.5],
  [21.6, 63.1],
  [22.8, 63.9],
  [24.5, 64.8],
  [25.4, 65.0],
  [25.0, 65.8],
  [24.1, 65.85],
  [22.1, 65.6],
  [21.3, 64.8],
  [20.3, 63.8],
  [18.9, 63.2],
  [17.4, 62.4],
  [17.2, 61.3],
  [17.2, 60.7],
  [18.4, 60.2],
  [18.9, 59.4],
  [18.0, 59.0],
  [16.5, 58.6],
  [16.7, 57.8],
  [16.4, 56.7],
  [15.6, 56.15],
  [14.3, 55.5],
  [12.9, 55.4],
  [12.9, 55.9],
  [12.6, 56.05],
  [12.4, 56.6],
  [11.8, 57.7],
  [11.1, 58.9],
  [10.8, 59.3],
  [10.6, 59.85],
  [10.2, 59.0],
  [9.6, 58.9],
  [8.0, 58.0],
  [6.6, 58.1],
  [5.6, 58.9],
  [5.3, 59.6],
  [5.0, 60.4],
  [5.0, 61.0],
  [5.2, 61.9],
  [6.1, 62.5],
  [7.7, 63.1],
  [8.9, 63.6],
  [10.0, 64.3],
  [11.5, 65.2],
  [12.5, 66.5],
  [30.0, 67.0],
  [47.0, 67.0],
  [47.0, 34.0],
  [35.9, 34.0],
  [35.8, 35.5],
  [36.0, 36.0],
  [36.2, 36.6],
  [35.6, 36.6],
  [35.0, 36.7],
  [34.0, 36.25],
  [32.8, 36.05],
  [31.5, 36.6],
  [30.6, 36.85],
  [30.5, 36.3],
  [29.3, 36.25],
  [28.3, 36.75],
  [27.4, 37.0],
  [27.2, 37.9],
  [26.7, 38.4],
  [26.4, 38.3],
  [26.9, 39.0],
  [26.6, 39.3],
  [26.1, 39.5],
  [26.2, 40.05],
  [27.0, 40.35],
  [28.0, 40.55],
  [29.0, 40.95],
  [29.1, 41.2],
  [29.6, 41.2],
  [31.8, 41.45],
  [33.5, 42.0],
  [35.1, 42.0],
  [36.3, 41.4],
  [37.9, 41.0],
  [39.7, 41.05],
  [41.6, 41.6],
  [41.65, 42.15],
  [41.0, 43.0],
  [39.7, 43.6],
  [37.8, 44.7],
  [36.6, 45.2],
  [36.7, 45.4],
  [37.5, 45.6],
  [38.1, 46.3],
  [38.9, 46.7],
  [39.3, 47.2],
  [38.5, 47.1],
  [37.6, 47.0],
  [36.5, 46.7],
  [35.4, 46.3],
  [34.9, 45.8],
  [35.4, 45.5],
  [36.45, 45.4],
  [36.45, 45.25],
  [35.4, 45.0],
  [34.2, 44.5],
  [33.5, 44.55],
  [33.4, 45.2],
  [32.5, 45.4],
  [31.7, 46.3],
  [30.75, 46.45],
  [30.2, 45.8],
  [29.7, 45.2],
  [28.65, 44.2],
  [27.95, 43.2],
  [27.5, 42.5],
  [28.0, 41.6],
  [28.95, 41.22],
  [28.9, 41.0],
  [28.0, 40.65],
  [27.0, 40.45],
  [26.25, 40.15],
  [26.2, 40.4],
  [26.0, 40.6],
  [25.9, 40.85],
  [24.4, 40.9],
  [23.9, 40.7],
  [23.5, 40.25],
  [22.9, 40.4],
  [22.6, 40.0],
  [22.9, 39.35],
  [23.3, 38.9],
  [24.0, 38.4],
  [24.0, 37.65],
  [23.4, 37.9],
  [22.8, 37.5],
  [23.0, 36.9],
  [23.2, 36.45],
  [22.5, 36.5],
  [22.1, 36.9],
  [21.7, 36.8],
  [21.6, 37.5],
  [21.4, 38.2],
  [21.7, 38.3],
  [21.1, 38.4],
  [20.7, 39.0],
  [20.2, 39.5],
  [20.0, 39.9],
  [19.4, 40.5],
  [19.5, 41.0],
  [19.4, 41.3],
  [19.5, 41.8],
  [19.1, 42.1],
  [18.6, 42.4],
  [18.1, 42.65],
  [17.4, 43.0],
  [16.4, 43.5],
  [15.9, 43.65],
  [15.2, 44.1],
  [14.9, 44.6],
  [14.4, 45.3],
  [13.85, 44.85],
  [13.6, 45.2],
  [13.7, 45.65],
  [13.1, 45.75],
  [12.35, 45.4],
  [12.3, 44.4],
  [13.5, 43.6],
  [14.2, 42.45],
  [15.1, 41.95],
  [16.2, 41.9],
  [15.9, 41.6],
  [16.9, 41.15],
  [18.0, 40.65],
  [18.5, 40.15],
  [18.0, 39.85],
  [17.2, 40.45],
  [16.5, 39.75],
  [17.1, 39.1],
  [16.5, 38.4],
  [15.65, 37.95],
  [15.8, 38.6],
  [16.2, 39.0],
  [15.7, 40.0],
  [14.75, 40.65],
  [14.2, 40.8],
  [13.5, 41.2],
  [12.25, 41.75],
  [11.8, 42.1],
  [11.1, 42.45],
  [10.5, 43.0],
  [10.3, 43.55],
  [9.85, 44.1],
  [8.9, 44.4],
  [8.4, 44.3],
  [7.7, 43.8],
  [7.3, 43.7],
  [6.6, 43.15],
  [5.9, 43.1],
  [5.3, 43.3],
  [4.6, 43.4],
  [3.9, 43.5],
  [3.1, 43.1],
  [3.0, 42.7],
  [3.2, 41.95],
  [2.2, 41.35],
  [1.25, 41.1],
  [0.85, 40.7],
  [0.0, 39.9],
  [-0.3, 39.45],
  [0.2, 38.75],
  [-0.5, 38.3],
  [-0.7, 37.6],
  [-1.0, 37.6],
  [-1.8, 36.9],
  [-2.4, 36.8],
  [-3.5, 36.75],
  [-4.4, 36.7],
  [-5.0, 36.45],
];

const BRITAIN = [
  [1.4, 51.1],
  [1.4, 51.4],
  [0.9, 51.55],
  [1.3, 51.9],
  [1.75, 52.5],
  [1.3, 52.95],
  [0.3, 52.9],
  [0.3, 53.5],
  [0.1, 53.65],
  [-0.1, 54.1],
  [-0.6, 54.5],
  [-1.2, 54.7],
  [-1.4, 55.0],
  [-2.0, 55.8],
  [-2.6, 56.05],
  [-2.6, 56.3],
  [-2.45, 56.7],
  [-2.0, 57.15],
  [-2.0, 57.7],
  [-4.0, 57.6],
  [-3.1, 58.45],
  [-3.5, 58.6],
  [-5.0, 58.6],
  [-5.6, 57.9],
  [-6.0, 57.3],
  [-5.8, 56.8],
  [-5.5, 56.4],
  [-5.7, 55.4],
  [-4.7, 55.45],
  [-5.1, 54.85],
  [-3.6, 54.95],
  [-3.5, 54.5],
  [-2.9, 54.1],
  [-3.1, 53.4],
  [-4.2, 53.3],
  [-4.6, 53.3],
  [-4.7, 52.8],
  [-4.1, 52.4],
  [-4.7, 52.1],
  [-5.2, 51.7],
  [-4.0, 51.6],
  [-3.2, 51.45],
  [-2.8, 51.5],
  [-3.4, 51.2],
  [-4.2, 51.2],
  [-5.7, 50.05],
  [-5.2, 49.95],
  [-4.15, 50.35],
  [-3.5, 50.45],
  [-2.45, 50.55],
  [-1.4, 50.85],
  [-0.15, 50.8],
  [0.25, 50.75],
];

const IRELAND = [
  [-5.9, 54.65],
  [-5.8, 54.85],
  [-6.2, 55.2],
  [-7.4, 55.4],
  [-8.5, 55.1],
  [-8.6, 54.3],
  [-10.0, 54.2],
  [-9.3, 53.2],
  [-9.9, 52.6],
  [-10.4, 52.0],
  [-9.8, 51.45],
  [-8.3, 51.8],
  [-7.0, 52.15],
  [-6.4, 52.2],
  [-6.1, 53.3],
  [-6.25, 53.75],
  [-6.3, 54.0],
];

const SICILY = [
  [15.6, 38.25],
  [15.1, 37.45],
  [15.3, 37.05],
  [15.1, 36.7],
  [14.2, 37.05],
  [13.5, 37.25],
  [12.45, 37.8],
  [12.5, 38.05],
  [13.35, 38.15],
  [14.0, 38.05],
  [15.25, 38.25],
];

const SARDINIA = [
  [9.6, 41.2],
  [9.8, 40.5],
  [9.65, 39.6],
  [9.6, 39.15],
  [9.0, 38.9],
  [8.4, 39.05],
  [8.4, 39.9],
  [8.4, 40.6],
  [8.2, 40.95],
  [8.9, 41.1],
];

const CORSICA = [
  [9.4, 43.0],
  [9.55, 42.1],
  [9.25, 41.4],
  [8.8, 41.6],
  [8.6, 42.3],
  [8.6, 42.65],
  [9.2, 43.0],
];

const ZEALAND = [
  [12.6, 56.05],
  [12.65, 55.6],
  [12.2, 55.2],
  [11.6, 55.0],
  [11.1, 55.25],
  [11.0, 55.75],
  [11.7, 56.0],
];

function project([lon, lat]) {
  return [((lon - LON0) / (LON1 - LON0)) * MAP_WIDTH, ((LAT1 - lat) / (LAT1 - LAT0)) * MAP_HEIGHT];
}

const LAND = [MAINLAND, BRITAIN, IRELAND, SICILY, SARDINIA, CORSICA, ZEALAND].map((ring) =>
  ring.map(project),
);

export function isLand(x, y) {
  return LAND.some((ring) => pointInPolygon(ring, x, y));
}

function area(polygon) {
  let total = 0;
  for (let k = 0; k < polygon.length; k++) {
    const p = polygon[k];
    const q = polygon[(k + 1) % polygon.length];
    total += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(total) / 2;
}

function landPiece(sites, index) {
  const [px, py] = sites[index];
  const rect = [
    [0, 0],
    [MAP_WIDTH, 0],
    [MAP_WIDTH, MAP_HEIGHT],
    [0, MAP_HEIGHT],
  ];
  let rings = LAND.map((ring) => {
    let clipped = ring;
    clipped = clipHalfPlane(clipped, 0, 0, -1, 0);
    clipped = clipHalfPlane(clipped, 0, 0, 0, -1);
    clipped = clipHalfPlane(clipped, MAP_WIDTH, 0, 1, 0);
    return clipHalfPlane(clipped, 0, MAP_HEIGHT, 0, 1);
  });
  let cell = rect;
  const order = sites
    .map((q, j) => [distanceSquared(q[0], q[1], px, py), j])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  for (const [d2, j] of order) {
    if (j === index) continue;
    let reach = 0;
    for (const v of cell) reach = Math.max(reach, distanceSquared(v[0], v[1], px, py));
    if (d2 > 4 * reach) break;
    const [qx, qy] = sites[j];
    const [mx, my, nx, ny] = [(px + qx) / 2, (py + qy) / 2, qx - px, qy - py];
    cell = clipHalfPlane(cell, mx, my, nx, ny);
    rings = rings.map((ring) => (ring.length ? clipHalfPlane(ring, mx, my, nx, ny) : ring));
  }
  const pieces = rings
    .filter((ring) => ring.length >= 3 && area(ring) > 0.5)
    .sort((a, b) => area(b) - area(a));
  return {
    cell,
    polygon: pieces[0] ?? cell,
    dropped: pieces.slice(1).reduce((sum, ring) => sum + area(ring), 0),
  };
}

function linkCells(provinces, landCount, seaId) {
  const edges = [];
  const owners = (x, y, skip) => {
    let best = -1;
    let bestDistance = Infinity;
    for (let j = 0; j < landCount; j++) {
      if (j === skip) continue;
      const d = distanceSquared(x, y, provinces[j].x, provinces[j].y);
      if (d < bestDistance && pointInPolygon(provinces[j].polygon, x, y)) {
        best = j;
        bestDistance = d;
      }
    }
    return best;
  };
  for (let i = 0; i < landCount; i++) {
    const poly = provinces[i].polygon;
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k];
      const b = poly[(k + 1) % poly.length];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (length < 0.5) continue;
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;
      const nx = (-(b[1] - a[1]) / length) * 1.5;
      const ny = ((b[0] - a[0]) / length) * 1.5;
      const outside = pointInPolygon(poly, mx + nx, my + ny) ? [mx - nx, my - ny] : [mx + nx, my + ny];
      const other = owners(outside[0], outside[1], i);
      if (other < 0) {
        edges.push({ a: i, b: seaId, x1: a[0], y1: a[1], x2: b[0], y2: b[1] });
        continue;
      }
      if (!provinces[i].neighbors.includes(other)) provinces[i].neighbors.push(other);
      if (!provinces[other].neighbors.includes(i)) provinces[other].neighbors.push(i);
      if (i < other) edges.push({ a: i, b: other, x1: a[0], y1: a[1], x2: b[0], y2: b[1] });
    }
  }
  return edges;
}

function bounds(provinces) {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of provinces) {
    for (const [x, y] of p.polygon) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  return {
    x0: Math.max(0, x0 - 10),
    y0: Math.max(0, y0 - 10),
    x1: Math.min(MAP_WIDTH, x1 + 10),
    y1: Math.min(MAP_HEIGHT, y1 + 10),
  };
}

function garrison(entry, flags) {
  const override = flags.find((f) => f.startsWith("T"));
  if (override) return Number(override.slice(1));
  const [, , , owner, terrain] = entry;
  if (flags.includes("C")) return 8;
  const neutral = OWNERS[owner] === undefined;
  const bonus = GARRISON_BONUS[owner] ?? 0;
  if (flags.includes("c")) return (neutral ? 6 : 4) + bonus;
  return (neutral ? [4, 5, 6][terrain] : [2, 3, 3][terrain]) + bonus;
}

let cached = null;

export function generateEurope(seed = 1939) {
  applyRoster(EUROPE_ROSTER);
  if (cached) return { ...cached, seed };

  const cities = PROVINCES.map((entry) => project([entry[1], entry[2]]));
  const landCount = cities.length;
  const seaId = landCount;
  const pieces = cities.map((_, id) => landPiece(cities, id));

  const provinces = PROVINCES.map((entry, id) => {
    const [name, , , owner, terrain, flagText] = entry;
    const flags = flagText.split(" ").filter(Boolean);
    const [x, y] = cities[id];
    return {
      id,
      x,
      y,
      polygon: pieces[id].polygon,
      neighbors: [],
      border: false,
      land: true,
      terrain,
      city: flags.includes("C") || flags.includes("c"),
      capitalOf: flags.includes("C") ? OWNERS[owner] : -1,
      name,
      realm: OWNERS[owner] === undefined ? owner : "",
      flags,
    };
  });
  provinces.push({
    id: seaId,
    x: 0,
    y: 0,
    polygon: [],
    neighbors: [],
    border: true,
    land: false,
    terrain: 0,
    city: false,
    capitalOf: -1,
    name: "",
    realm: "",
    flags: [],
  });

  const edges = linkCells(provinces, landCount, seaId);
  const byName = new Map(provinces.map((p) => [p.name, p.id]));
  const links = LINKS.map(([a, b]) => [byName.get(a), byName.get(b)]);
  for (const [a, b] of links) {
    if (!provinces[a].neighbors.includes(b)) provinces[a].neighbors.push(b);
    if (!provinces[b].neighbors.includes(a)) provinces[b].neighbors.push(a);
  }

  const count = provinces.length;
  const start = {
    owner: new Array(count).fill(NEUTRAL),
    troops: new Array(count).fill(0),
    forts: new Array(count).fill(0),
    factories: new Array(count).fill(0),
    industry: NATIONS.map((n) => INDUSTRY[n] ?? 0),
    faction: NATIONS.map((n) => FACTIONS[n] ?? NEUTRAL),
  };
  PROVINCES.forEach((entry, id) => {
    const flags = provinces[id].flags;
    start.owner[id] = OWNERS[entry[3]] ?? NEUTRAL;
    start.troops[id] = garrison(entry, flags);
    start.forts[id] = flags.includes("f") ? 1 : 0;
    const factory = flags.find((f) => /^F\d$/.test(f));
    start.factories[id] = factory ? Number(factory[1]) : 0;
  });

  const capitals = NATIONS.slice(0, EUROPE_ROSTER.length).map((n) =>
    provinces.findIndex((p) => p.capitalOf === n),
  );
  cached = {
    seed: 1939,
    options: { scenario: "europe" },
    scenario: "europe",
    nationCount: EUROPE_ROSTER.length,
    roster: EUROPE_ROSTER,
    firstTurn: FIRST_TURN,
    factionNames: FACTION_NAMES,
    incomeScale: 0.6,
    links,
    provinces,
    edges,
    capitals,
    start,
    bounds: bounds(provinces.slice(0, landCount)),
    hash: 19390901 + landCount,
    totalVictoryPoints: provinces.reduce((sum, p) => sum + (p.city ? (p.capitalOf >= 0 ? 3 : 1) : 0), 0),
  };
  return { ...cached, seed };
}
