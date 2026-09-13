/**
 * dictionary-6x6-250-data.js
 * ---------------------------
 * Rohdaten des echten OpenCV-Dictionarys `cv2.aruco.DICT_6X6_250`: 250 Marker-Codes
 * (je ein 36-Bit-Wert für ein 6x6-Bit-Muster, Rotation 0).
 *
 * js-aruco2 (die hier verwendete Browser-Bibliothek zur Markererkennung) bringt dieses
 * Dictionary NICHT mit - nur die eigenen Formate "ARUCO" und "ARUCO_MIP_36h12". Damit
 * echte, bereits mit OpenCV/Python bedruckte DICT_6X6_250-Marker erkannt werden, muss
 * das Dictionary hier nachgebildet werden.
 *
 * WICHTIG - Herkunft dieser Zahlen: Sie sind NICHT frei erfunden oder geschätzt, sondern
 * wurden direkt aus dem offiziellen OpenCV-Quellcode extrahiert:
 *   modules/objdetect/src/aruco/predefined_dictionaries.hpp → DICT_6X6_1000_BYTES
 *   (DICT_6X6_250 sind laut aruco_dictionary.cpp exakt die ersten 250 Einträge davon)
 * und bit-genau nach demselben Schema gepackt, das OpenCV selbst verwendet
 * (Dictionary::getByteListFromBits: zeilenweise über das 6x6-Raster, MSB zuerst).
 *
 * Kontrollrechnung als Plausibilitätscheck: die minimale Hamming-Distanz zwischen allen
 * Codepaaren dieser 250 Werte ergibt exakt 11 - genau der von OpenCV dokumentierte Wert
 * für DICT_6X6_250 (maxCorrectionBits=5, also minDistance=2*5+1=11). Diese exakte
 * Übereinstimmung ist ein starkes Indiz für eine korrekte Extraktion.
 *
 * Nicht abschließend verifiziert ist dagegen, ob js-aruco2s eigene Bit-Abtastreihenfolge
 * (in AR.Detector.prototype.getMarker, siehe node_modules/js-aruco2/src/aruco.js) exakt
 * mit dieser Konvention übereinstimmt - ein Quellcode-Vergleich beider Bibliotheken
 * deutet stark darauf hin (siehe aruco-setup.js), ein Test an einem echten Foto mit
 * echtem Marker wurde in der Entwicklungsumgebung dieses Projekts aber nicht gemacht.
 * Falls Marker partout nicht erkannt werden: das ist der erste Verdachtspunkt.
 *
 * @type {number[]}
 */
export const DICT_6X6_250_CODES = [
  0x1e3dd82a6, 0xefba3891, 0x15907eacd, 0xc91b3069e, 0xd607d6e15, 0xd8e8e0e68, 0x4268b41f5, 0x88a50f29a, 0x307d524fd, 0x3c2f34b3c,
  0x45dfc74e3, 0x48d85b257, 0x710558fc6, 0x86dcfad07, 0x8d72a93f6, 0xa2b89dcde, 0x9fd1e9c4, 0x154dbd18f, 0x300a310e2, 0x4807efafd,
  0x56df11db6, 0x66883274c, 0x76e8cb781, 0x9a53d9cf3, 0xa9cb84024, 0xc67549490, 0xc1d288941, 0xe7480852b, 0xea2fca848, 0xe963b77b1,
  0xfa36652af, 0x65bff7bd, 0x541d72d6, 0xcf7246a2, 0x1338a39eb, 0x15a893e74, 0x3a417ee9e, 0x4f11e26c0, 0x530db6d20, 0x589bfae34,
  0x6409e8a0b, 0x60537a891, 0x6159069ba, 0x6bff78d7b, 0x70ad96a4f, 0x75846f71a, 0x7a95192fc, 0x8609760aa, 0x8a2d44c3f, 0x93eb78b14,
  0x988da84d4, 0x9ede2b3c8, 0xa529e07b8, 0xb593b855f, 0xb7f8e426f, 0xbc205225e, 0xc04487765, 0xc4c324259, 0xc5a91bd8d, 0xce73e6b2c,
  0xcd0ca6272, 0xc9435d44d, 0xcfbe80f34, 0xe57d15877, 0xefc6858e9, 0xf77ef3772, 0x2ce43f254, 0x2bdcff4b3, 0x37c7ddbda, 0xa1a254e0f,
  0xa982c1bb5, 0xd81b49b08, 0x35829f86, 0x7c4095fc, 0xfe26617b, 0x144836441, 0x10ad5ffb7, 0x12829553f, 0x16e13184c, 0x187a496b0,
  0x1ae886112, 0x1913ae0a1, 0x1b67b5a17, 0x25dc95f0b, 0x288961f76, 0x3354146aa, 0x31c16c1f7, 0x33cb18c66, 0x3ecfe490f, 0x464518a3f,
  0x44ba70b67, 0x419c623e8, 0x48d1914a1, 0x54f499f6d, 0x575a9c813, 0x558355b2c, 0x57b77610f, 0x5c3436fe4, 0x5c48fc77e, 0x5e6eef402,
  0x5f233b6ff, 0x5b742a632, 0x650fa33ae, 0x65d3175cc, 0x6a9c245ae, 0x69c5f3042, 0x69d2484ea, 0x7479e2de6, 0x72cf23eab, 0x77b1dc414,
  0x7e0c07217, 0x7a6970647, 0x78b2d8707, 0x79c585794, 0x866f59fc6, 0x82f6727f5, 0x854e2f414, 0x9a1185934, 0x9c7160c97, 0x9dd194fd8,
  0xa21e12e38, 0xae701c82c, 0xad01219c1, 0xb0351f9ee, 0xb64ad80d4, 0xb537314b4, 0xbeaac7e3b, 0xbb683dbcf, 0xc672f72c1, 0xc1e74dbab,
  0xcb55ee59d, 0xcba053724, 0xd0090fcf1, 0xd06c3ad54, 0xd3f120574, 0xe6e33b1a7, 0xe3533ea4a, 0xe8068eb14, 0xec07c0597, 0xeaf3803da,
  0xf63b27d88, 0xf30798379, 0xfe4bba9b9, 0xaba57d86b, 0xc0d1625ab, 0x13ce7bae7, 0x4e81fd617, 0x56e076320, 0x6a708a540, 0x72a898a18,
  0x815d42f80, 0xcf4cc3d5f, 0xd6bb65864, 0xecd313a31, 0xf521f5207, 0xf91fa5df7, 0x24f47a7, 0x84d882, 0x43cc2f29, 0x47b50211,
  0x67ae4c1d, 0xaa968a3, 0x4d138e94, 0x510a80da, 0x140b0007, 0x19d9cee1, 0x81057e3b, 0x86b97b66, 0xee8b860a, 0xb6c76b9b,
  0xfdcb98cb, 0xfcacf3a0, 0x14249fd98, 0x1407201fd, 0x150910d57, 0x135cd7307, 0x11479abb6, 0x1cb9a9238, 0x1cdd07766, 0x1f2e7c24b,
  0x196642477, 0x1957d4c84, 0x1fa8f4f04, 0x1b8246ed8, 0x1baee10fe, 0x22a4b63ca, 0x22bf9012f, 0x232c15b40, 0x255aa966c, 0x27a5afa97,
  0x25f40e425, 0x286655cde, 0x2c427e0e0, 0x2ab97cbd0, 0x2946e1d23, 0x2da628410, 0x2bfb209a6, 0x368cd66bc, 0x3487777c7, 0x34ddeb840,
  0x3791f76f1, 0x3a228e175, 0x3e13bd408, 0x3c9843ca2, 0x39589d179, 0x3974daeeb, 0x3f6dbc731, 0x3d6bc050c, 0x39ab27497, 0x46024e25e,
  0x4682ba0bc, 0x42e9cd5ae, 0x44c9b7b3f, 0x40c7d41e9, 0x46d2b4cce, 0x43195356b, 0x4122e6dd9, 0x4753a59ab, 0x4e1ef1e08, 0x4e4ac0960,
  0x4e5faa06f, 0x4a8d32943, 0x491594b39, 0x4d4ddb621, 0x4ba761e81, 0x49d483d8e, 0x56290ef6c, 0x537ed5ffc, 0x55f5a7afa, 0x55d5ea64f,
  0x581bab1da, 0x5ebe926dd, 0x5f10f99b5, 0x5d1edfa5c, 0x5f718df02, 0x5de11e468, 0x6033bb247, 0x64581afe1, 0x63c8dda76, 0x61da3d8fd,
  0x6e3a22afa, 0x6e6105b71, 0x6a89a9e8c, 0x6a97224f5, 0x6b12c3801, 0x6b684b22a, 0x6f94c1579, 0x6da6fea0d, 0x6feaca457, 0x703d38a60,
];
