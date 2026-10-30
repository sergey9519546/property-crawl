'use strict';

const { queryLocalParcelIndex } = require('./local-parcel-index');

/**
 * Statewide ArcGIS REST FeatureServer / MapServer Registry
 * Official state-published composite parcel services with verified valuation fields.
 * Used when a state publishes a statewide parcel roll covering all or participating counties.
 */
const STATEWIDE_ARCGIS_REGISTRY = {
  NJ: {
    name: 'NJGIN / NJOGIS Statewide Parcels & MOD-IV Composite',
    stateFips: '34',
    endpoint: 'https://maps.nj.gov/arcgis/rest/services/Framework/Cadastral/MapServer/0/query',
    apnField: 'PAMS_PIN',
    landUseField: 'PROP_CLASS',
    assessedTotalField: 'NET_VALUE',
    assessedLandField: 'LAND_VAL',
    assessedImprvField: 'IMPRVT_VAL',
    legalDescField: 'BLDG_DESC',
    situsAddressField: 'ST_ADDRESS',
    countyFilterField: 'COUNTY'
  },
  FL: {
    name: 'Florida GIO / FDOR Statewide Cadastral Parcel Centroids (NAL Roll)',
    stateFips: '12',
    endpoint: 'https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Parcel_Centroid_Version/FeatureServer/0/query',
    apnField: 'PARCEL_ID',
    landUseField: 'DOR_UC',
    assessedTotalField: 'JV',
    assessedLandField: 'LND_VAL',
    assessedImprvField: null,
    legalDescField: 'S_LEGAL',
    situsAddressField: 'PHY_ADDR1',
    spatialFallback: 'envelope'
  },
  CO: {
    name: 'Colorado Governor\'s Office of IT (OIT) Statewide Public Parcels',
    stateFips: '08',
    endpoint: 'https://gis.colorado.gov/public/rest/services/Address_and_Parcel/Colorado_Public_Parcels/FeatureServer/0/query',
    apnField: 'parcel_id',
    landUseField: 'landUseDsc',
    assessedTotalField: 'apprValTot',
    assessedLandField: null,
    assessedImprvField: null,
    legalDescField: 'legalDesc',
    situsAddressField: 'situsAdd',
    countyFilterField: 'countyName'
  },
  NC: {
    name: 'NC OneMap Statewide Parcels (Polygons)',
    stateFips: '37',
    endpoint: 'https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/MapServer/1/query',
    apnField: 'parno',
    landUseField: 'parusedesc',
    assessedTotalField: 'parval',
    assessedLandField: 'landval',
    assessedImprvField: 'improvval',
    legalDescField: 'legdecfull',
    situsAddressField: 'siteadd',
    countyFilterField: 'cntyname'
  },
  NY: {
    name: 'NYS GIS Program Office Statewide Tax Parcel Centroid Points',
    stateFips: '36',
    endpoint: 'https://nysgeohub.ny.gov/arcgis/rest/services/Parcels/NYS_Tax_Parcel_Centroid_Points/FeatureServer/0/query',
    apnField: 'PRINT_KEY',
    landUseField: 'PROP_CLASS',
    assessedTotalField: 'FULL_MARKET_VAL',
    assessedLandField: 'LAND_AV',
    assessedImprvField: null,
    legalDescField: 'BLDG_STYLE_DESC',
    situsAddressField: 'PARCEL_ADDR',
    countyFilterField: 'COUNTY_NAME',
    spatialFallback: 'envelope'
  },
  WI: {
    name: 'Wisconsin DOA Statewide Parcel Database (V12)',
    stateFips: '55',
    endpoint: 'https://services3.arcgis.com/n6uYoouQZW75n5WI/arcgis/rest/services/Wisconsin_Statewide_Parcels_DB/FeatureServer/0/query',
    apnField: 'PARCELID',
    landUseField: 'PROPCLASS',
    assessedTotalField: 'ESTFMKVALUE',
    assessedLandField: 'LNDVALUE',
    assessedImprvField: 'IMPVALUE',
    legalDescField: 'PLACENAME',
    situsAddressField: 'SITEADRESS',
    countyFilterField: 'CONAME'
  },
  CT: {
    name: 'Connecticut OPM Statewide CAMA and Parcel Layer',
    stateFips: '09',
    endpoint: 'https://services3.arcgis.com/3FL1kr7L4LvwA2Kb/arcgis/rest/services/Connecticut_CAMA_and_Parcel_Layer_2025/FeatureServer/0/query',
    apnField: 'Parcel_ID',
    landUseField: 'State_Use_Description',
    assessedTotalField: 'Assessed_Total',
    assessedLandField: 'Assessed_Land',
    assessedImprvField: 'Assessed_Building',
    legalDescField: 'Zone',
    situsAddressField: 'Location'
  },
  AR: {
    name: 'Arkansas GIS Office Statewide Cadastral Parcels (CAMP)',
    stateFips: '05',
    endpoint: 'https://gis.arkansas.gov/arcgis/rest/services/FEATURESERVICES/Planning_Cadastre/FeatureServer/6/query',
    apnField: 'parcelid',
    landUseField: 'parceltype',
    assessedTotalField: 'totalvalue',
    assessedLandField: 'landvalue',
    assessedImprvField: 'impvalue',
    legalDescField: 'parcellgl',
    situsAddressField: 'adrlabel',
    countyFilterField: 'county'
  }
};

function buildStatewideCountyEntries(state, baseConfig, counties) {
  const entries = {};
  for (const [countyKeyName, fips, displayName] of counties) {
    entries[`${state}-${countyKeyName}`] = {
      name: `${displayName} (${baseConfig.name})`,
      fips,
      endpoint: baseConfig.endpoint,
      apnField: baseConfig.apnField,
      landUseField: baseConfig.landUseField,
      assessedTotalField: baseConfig.assessedTotalField,
      assessedLandField: baseConfig.assessedLandField,
      assessedImprvField: baseConfig.assessedImprvField,
      legalDescField: baseConfig.legalDescField,
      situsAddressField: baseConfig.situsAddressField,
      ...(baseConfig.spatialFallback ? { spatialFallback: baseConfig.spatialFallback } : {}),
      ...(baseConfig.countyFilterField ? { countyFilterField: baseConfig.countyFilterField } : {}),
      statewideService: state
    };
  }
  return entries;
}

const NJ_COUNTY_ENTRIES = buildStatewideCountyEntries('NJ', STATEWIDE_ARCGIS_REGISTRY.NJ, [
  ['ATLANTIC', '34001', 'Atlantic County Tax Board'],
  ['BERGEN', '34003', 'Bergen County Board of Taxation'],
  ['BURLINGTON', '34005', 'Burlington County Board of Taxation'],
  ['CAMDEN', '34007', 'Camden County Board of Taxation'],
  ['CAPE MAY', '34009', 'Cape May County Board of Taxation'],
  ['CUMBERLAND', '34011', 'Cumberland County Board of Taxation'],
  ['ESSEX', '34013', 'Essex County Board of Taxation'],
  ['GLOUCESTER', '34015', 'Gloucester County Board of Taxation'],
  ['HUDSON', '34017', 'Hudson County Board of Taxation'],
  ['HUNTERDON', '34019', 'Hunterdon County Board of Taxation'],
  ['MERCER', '34021', 'Mercer County Board of Taxation'],
  ['MIDDLESEX', '34023', 'Middlesex County Board of Taxation'],
  ['MONMOUTH', '34025', 'Monmouth County Board of Taxation'],
  ['MORRIS', '34027', 'Morris County Board of Taxation'],
  ['OCEAN', '34029', 'Ocean County Board of Taxation'],
  ['PASSAIC', '34031', 'Passaic County Board of Taxation'],
  ['SALEM', '34033', 'Salem County Board of Taxation'],
  ['SOMERSET', '34035', 'Somerset County Board of Taxation'],
  ['SUSSEX', '34037', 'Sussex County Board of Taxation'],
  ['UNION', '34039', 'Union County Board of Taxation'],
  ['WARREN', '34041', 'Warren County Board of Taxation']
]);

const FL_STATEWIDE_COUNTY_ENTRIES = buildStatewideCountyEntries('FL', STATEWIDE_ARCGIS_REGISTRY.FL, [
  ['BAKER', '12003', 'Baker County Property Appraiser'],
  ['BAY', '12005', 'Bay County Property Appraiser'],
  ['BRADFORD', '12007', 'Bradford County Property Appraiser'],
  ['BROWARD', '12011', 'Broward County Property Appraiser'],
  ['CHARLOTTE', '12015', 'Charlotte County Property Appraiser'],
  ['CITRUS', '12017', 'Citrus County Property Appraiser'],
  ['CLAY', '12019', 'Clay County Property Appraiser'],
  ['COLLIER', '12021', 'Collier County Property Appraiser'],
  ['DUVAL', '12031', 'Duval County Property Appraiser (Jacksonville)'],
  ['ESCAMBIA', '12033', 'Escambia County Property Appraiser (Pensacola)'],
  ['FLAGLER', '12035', 'Flagler County Property Appraiser'],
  ['FRANKLIN', '12037', 'Franklin County Property Appraiser'],
  ['GADSDEN', '12039', 'Gadsden County Property Appraiser'],
  ['HENDRY', '12051', 'Hendry County Property Appraiser'],
  ['HERNANDO', '12053', 'Hernando County Property Appraiser'],
  ['HIGHLANDS', '12055', 'Highlands County Property Appraiser'],
  ['HILLSBOROUGH', '12057', 'Hillsborough County Property Appraiser (Tampa)'],
  ['HOLMES', '12059', 'Holmes County Property Appraiser'],
  ['INDIAN RIVER', '12061', 'Indian River County Property Appraiser'],
  ['LAFAYETTE', '12067', 'Lafayette County Property Appraiser'],
  ['LAKE', '12069', 'Lake County Property Appraiser'],
  ['LEE', '12071', 'Lee County Property Appraiser (Fort Myers)'],
  ['LEON', '12073', 'Leon County Property Appraiser (Tallahassee)'],
  ['MANATEE', '12081', 'Manatee County Property Appraiser'],
  ['MARION', '12083', 'Marion County Property Appraiser (Ocala)'],
  ['MARTIN', '12085', 'Martin County Property Appraiser'],
  ['MIAMI-DADE', '12086', 'Miami-Dade County Property Appraiser'],
  ['MIAMI DADE', '12086', 'Miami-Dade County Property Appraiser'],
  ['OKALOOSA', '12091', 'Okaloosa County Property Appraiser'],
  ['OKEECHOBEE', '12093', 'Okeechobee County Property Appraiser'],
  ['OSCEOLA', '12097', 'Osceola County Property Appraiser'],
  ['PASCO', '12101', 'Pasco County Property Appraiser'],
  ['POLK', '12105', 'Polk County Property Appraiser (Lakeland)'],
  ['PUTNAM', '12107', 'Putnam County Property Appraiser'],
  ['SANTA ROSA', '12113', 'Santa Rosa County Property Appraiser'],
  ['SARASOTA', '12115', 'Sarasota County Property Appraiser'],
  ['SEMINOLE', '12117', 'Seminole County Property Appraiser'],
  ['ST. JOHNS', '12109', 'St. Johns County Property Appraiser'],
  ['ST JOHNS', '12109', 'St. Johns County Property Appraiser'],
  ['ST. LUCIE', '12111', 'St. Lucie County Property Appraiser'],
  ['ST LUCIE', '12111', 'St. Lucie County Property Appraiser'],
  ['SUMTER', '12119', 'Sumter County Property Appraiser'],
  ['SUWANNEE', '12121', 'Suwannee County Property Appraiser'],
  ['TAYLOR', '12123', 'Taylor County Property Appraiser'],
  ['UNION', '12125', 'Union County Property Appraiser'],
  ['VOLUSIA', '12127', 'Volusia County Property Appraiser (Daytona Beach)'],
  ['WALTON', '12131', 'Walton County Property Appraiser'],
  ['WASHINGTON', '12133', 'Washington County Property Appraiser']
]);

const CO_COUNTY_ENTRIES = buildStatewideCountyEntries('CO', STATEWIDE_ARCGIS_REGISTRY.CO, [
  ['ADAMS', '08001', 'Adams County Assessor'],
  ['ALAMOSA', '08003', 'Alamosa County Assessor'],
  ['ARAPAHOE', '08005', 'Arapahoe County Assessor'],
  ['ARCHULETA', '08007', 'Archuleta County Assessor'],
  ['BOULDER', '08013', 'Boulder County Assessor'],
  ['BROOMFIELD', '08014', 'City and County of Broomfield Assessor'],
  ['CONEJOS', '08021', 'Conejos County Assessor'],
  ['CROWLEY', '08025', 'Crowley County Assessor'],
  ['DELTA', '08029', 'Delta County Assessor'],
  ['DENVER', '08031', 'City and County of Denver Assessor'],
  ['DOUGLAS', '08035', 'Douglas County Assessor'],
  ['EAGLE', '08037', 'Eagle County Assessor'],
  ['ELBERT', '08039', 'Elbert County Assessor'],
  ['EL PASO', '08041', 'El Paso County Assessor (Colorado Springs)'],
  ['FREMONT', '08043', 'Fremont County Assessor'],
  ['GARFIELD', '08045', 'Garfield County Assessor'],
  ['HUERFANO', '08055', 'Huerfano County Assessor'],
  ['JEFFERSON', '08059', 'Jefferson County Assessor'],
  ['LA PLATA', '08067', 'La Plata County Assessor'],
  ['LARIMER', '08069', 'Larimer County Assessor (Fort Collins)'],
  ['LINCOLN', '08073', 'Lincoln County Assessor'],
  ['LOGAN', '08075', 'Logan County Assessor'],
  ['MESA', '08077', 'Mesa County Assessor (Grand Junction)'],
  ['MOFFAT', '08081', 'Moffat County Assessor'],
  ['MONTEZUMA', '08083', 'Montezuma County Assessor'],
  ['MONTROSE', '08085', 'Montrose County Assessor'],
  ['MORGAN', '08087', 'Morgan County Assessor'],
  ['OTERO', '08089', 'Otero County Assessor'],
  ['PARK', '08093', 'Park County Assessor'],
  ['PUEBLO', '08101', 'Pueblo County Assessor'],
  ['SAGUACHE', '08109', 'Saguache County Assessor'],
  ['SUMMIT', '08117', 'Summit County Assessor'],
  ['TELLER', '08119', 'Teller County Assessor'],
  ['WASHINGTON', '08121', 'Washington County Assessor'],
  ['WELD', '08123', 'Weld County Assessor (Greeley)'],
  ['YUMA', '08125', 'Yuma County Assessor']
]);

const NC_COUNTY_ENTRIES = buildStatewideCountyEntries('NC', STATEWIDE_ARCGIS_REGISTRY.NC, [
  ['ALAMANCE', '37001', 'Alamance County Tax Assessor'],
  ['ALEXANDER', '37003', 'Alexander County Tax Assessor'],
  ['AVERY', '37011', 'Avery County Tax Assessor'],
  ['BLADEN', '37017', 'Bladen County Tax Assessor'],
  ['BRUNSWICK', '37019', 'Brunswick County Tax Assessor'],
  ['BUNCOMBE', '37021', 'Buncombe County Tax Assessor (Asheville)'],
  ['BURKE', '37023', 'Burke County Tax Assessor'],
  ['CABARRUS', '37025', 'Cabarrus County Tax Assessor'],
  ['CALDWELL', '37027', 'Caldwell County Tax Assessor'],
  ['CAMDEN', '37029', 'Camden County Tax Assessor'],
  ['CARTERET', '37031', 'Carteret County Tax Assessor'],
  ['CASWELL', '37033', 'Caswell County Tax Assessor'],
  ['CATAWBA', '37035', 'Catawba County Tax Assessor'],
  ['CHATHAM', '37037', 'Chatham County Tax Assessor'],
  ['CLEVELAND', '37045', 'Cleveland County Tax Assessor'],
  ['COLUMBUS', '37047', 'Columbus County Tax Assessor'],
  ['CRAVEN', '37049', 'Craven County Tax Assessor'],
  ['CUMBERLAND', '37051', 'Cumberland County Tax Assessor (Fayetteville)'],
  ['CURRITUCK', '37053', 'Currituck County Tax Assessor'],
  ['DARE', '37055', 'Dare County Tax Assessor'],
  ['DAVIDSON', '37057', 'Davidson County Tax Assessor'],
  ['DUPLIN', '37061', 'Duplin County Tax Assessor'],
  ['DURHAM', '37063', 'Durham County Tax Assessor'],
  ['EDGECOMBE', '37065', 'Edgecombe County Tax Assessor'],
  ['FORSYTH', '37067', 'Forsyth County Tax Assessor (Winston-Salem)'],
  ['GASTON', '37071', 'Gaston County Tax Assessor'],
  ['GUILFORD', '37081', 'Guilford County Tax Assessor (Greensboro)'],
  ['HALIFAX', '37083', 'Halifax County Tax Assessor'],
  ['HARNETT', '37085', 'Harnett County Tax Assessor'],
  ['HENDERSON', '37089', 'Henderson County Tax Assessor'],
  ['HOKE', '37093', 'Hoke County Tax Assessor'],
  ['IREDELL', '37097', 'Iredell County Tax Assessor'],
  ['JOHNSTON', '37101', 'Johnston County Tax Assessor'],
  ['JONES', '37103', 'Jones County Tax Assessor'],
  ['LEE', '37105', 'Lee County Tax Assessor'],
  ['LENOIR', '37107', 'Lenoir County Tax Assessor'],
  ['LINCOLN', '37109', 'Lincoln County Tax Assessor'],
  ['MACON', '37113', 'Macon County Tax Assessor'],
  ['MARTIN', '37117', 'Martin County Tax Assessor'],
  ['MECKLENBURG', '37119', 'Mecklenburg County Assessor (Charlotte)'],
  ['MITCHELL', '37121', 'Mitchell County Tax Assessor'],
  ['MONTGOMERY', '37123', 'Montgomery County Tax Assessor'],
  ['MOORE', '37125', 'Moore County Tax Assessor'],
  ['NASH', '37127', 'Nash County Tax Assessor'],
  ['NEW HANOVER', '37129', 'New Hanover County Tax Assessor (Wilmington)'],
  ['ONSLOW', '37133', 'Onslow County Tax Assessor (Jacksonville)'],
  ['ORANGE', '37135', 'Orange County Tax Assessor'],
  ['PASQUOTANK', '37139', 'Pasquotank County Tax Assessor'],
  ['PERQUIMANS', '37143', 'Perquimans County Tax Assessor'],
  ['PERSON', '37145', 'Person County Tax Assessor'],
  ['PITT', '37147', 'Pitt County Tax Assessor (Greenville)'],
  ['POLK', '37149', 'Polk County Tax Assessor'],
  ['RANDOLPH', '37151', 'Randolph County Tax Assessor'],
  ['ROBESON', '37155', 'Robeson County Tax Assessor'],
  ['ROCKINGHAM', '37157', 'Rockingham County Tax Assessor'],
  ['ROWAN', '37159', 'Rowan County Tax Assessor'],
  ['SAMPSON', '37163', 'Sampson County Tax Assessor'],
  ['STANLY', '37167', 'Stanly County Tax Assessor'],
  ['SURRY', '37171', 'Surry County Tax Assessor'],
  ['UNION', '37179', 'Union County Tax Assessor'],
  ['WAKE', '37183', 'Wake County Tax Assessor (Raleigh)'],
  ['WARREN', '37185', 'Warren County Tax Assessor'],
  ['WATAUGA', '37189', 'Watauga County Tax Assessor'],
  ['WAYNE', '37191', 'Wayne County Tax Assessor'],
  ['WILKES', '37193', 'Wilkes County Tax Assessor'],
  ['WILSON', '37195', 'Wilson County Tax Assessor'],
  ['YADKIN', '37197', 'Yadkin County Tax Assessor']
]);

const NY_COUNTY_ENTRIES = buildStatewideCountyEntries('NY', STATEWIDE_ARCGIS_REGISTRY.NY, [
  ['ALBANY', '36001', 'Albany County Real Property Tax Service'],
  ['BRONX', '36005', 'Bronx County / NYC Department of Finance'],
  ['BROOME', '36007', 'Broome County Real Property Tax Service'],
  ['CATTARAUGUS', '36009', 'Cattaraugus County Real Property Tax Service'],
  ['CAYUGA', '36011', 'Cayuga County Real Property Tax Service'],
  ['CHAUTAUQUA', '36013', 'Chautauqua County Real Property Tax Service'],
  ['CHEMUNG', '36015', 'Chemung County Real Property Tax Service'],
  ['CHENANGO', '36017', 'Chenango County Real Property Tax Service'],
  ['CLINTON', '36019', 'Clinton County Real Property Tax Service'],
  ['CORTLAND', '36023', 'Cortland County Real Property Tax Service'],
  ['DUTCHESS', '36027', 'Dutchess County Real Property Tax Service'],
  ['ERIE', '36029', 'Erie County Real Property Tax Services (Buffalo)'],
  ['ESSEX', '36031', 'Essex County Real Property Tax Service'],
  ['FULTON', '36035', 'Fulton County Real Property Tax Service'],
  ['GREENE', '36039', 'Greene County Real Property Tax Service'],
  ['HERKIMER', '36043', 'Herkimer County Real Property Tax Service'],
  ['JEFFERSON', '36045', 'Jefferson County Real Property Tax Service'],
  ['KINGS', '36047', 'Kings County (Brooklyn) / NYC Department of Finance'],
  ['KING', '36047', 'Kings County (Brooklyn) / NYC Department of Finance'],
  ['MADISON', '36053', 'Madison County Real Property Tax Service'],
  ['MONROE', '36055', 'Monroe County Real Property Tax Services (Rochester)'],
  ['MONTGOMERY', '36057', 'Montgomery County Real Property Tax Service'],
  ['NASSAU', '36059', 'Nassau County Department of Assessment'],
  ['NEW YORK', '36061', 'New York County (Manhattan) / NYC Department of Finance'],
  ['NIAGARA', '36063', 'Niagara County Real Property Tax Service'],
  ['ONEIDA', '36065', 'Oneida County Real Property Tax Service'],
  ['ONONDAGA', '36067', 'Onondaga County Real Property Tax Services (Syracuse)'],
  ['ONTARIO', '36069', 'Ontario County Real Property Tax Service'],
  ['ORANGE', '36071', 'Orange County Real Property Tax Service'],
  ['ORLEANS', '36073', 'Orleans County Real Property Tax Service'],
  ['OSWEGO', '36075', 'Oswego County Real Property Tax Service'],
  ['OTSEGO', '36077', 'Otsego County Real Property Tax Service'],
  ['OSTEGO', '36077', 'Otsego County Real Property Tax Service'],
  ['QUEENS', '36081', 'Queens County / NYC Department of Finance'],
  ['RENSSELAER', '36083', 'Rensselaer County Real Property Tax Service'],
  ['RICHMOND', '36085', 'Richmond County (Staten Island) / NYC Department of Finance'],
  ['ROCKLAND', '36087', 'Rockland County Real Property Tax Service'],
  ['SARATOGA', '36091', 'Saratoga County Real Property Tax Service'],
  ['SCHENECTADY', '36093', 'Schenectady County Real Property Tax Service'],
  ['SCHOHARIE', '36095', 'Schoharie County Real Property Tax Service'],
  ['ST. LAWRENCE', '36089', 'St. Lawrence County Real Property Tax Service'],
  ['ST LAWRENCE', '36089', 'St. Lawrence County Real Property Tax Service'],
  ['STEUBEN', '36101', 'Steuben County Real Property Tax Service'],
  ['SUFFOLK', '36103', 'Suffolk County Real Property Tax Service Agency'],
  ['SULLIVAN', '36105', 'Sullivan County Real Property Tax Service'],
  ['TIOGA', '36107', 'Tioga County Real Property Tax Service'],
  ['ULSTER', '36111', 'Ulster County Real Property Tax Service'],
  ['WARREN', '36113', 'Warren County Real Property Tax Service'],
  ['WASHINGTON', '36115', 'Washington County Real Property Tax Service'],
  ['WAYNE', '36117', 'Wayne County Real Property Tax Service'],
  ['WESTCHESTER', '36119', 'Westchester County Tax Commission'],
  ['WYOMING', '36121', 'Wyoming County Real Property Tax Service']
]);

const WI_COUNTY_ENTRIES = buildStatewideCountyEntries('WI', STATEWIDE_ARCGIS_REGISTRY.WI, [
  ['ASHLAND', '55003', 'Ashland County Land Description'],
  ['BARRON', '55005', 'Barron County Land Information'],
  ['BROWN', '55009', 'Brown County Planning & Land Services (Green Bay)'],
  ['BURNETT', '55013', 'Burnett County Land Information'],
  ['COLUMBIA', '55021', 'Columbia County Land Information'],
  ['DANE', '55025', 'Dane County Land Information (Madison)'],
  ['DOUGLAS', '55031', 'Douglas County Land Information'],
  ['IRON', '55051', 'Iron County Land Information'],
  ['JEFFERSON', '55055', 'Jefferson County Land Information'],
  ['KENOSHA', '55059', 'Kenosha County Land Information'],
  ['LANGLADE', '55067', 'Langlade County Land Records'],
  ['MARINETTE', '55075', 'Marinette County Land Information'],
  ['MILWAUKEE', '55079', 'Milwaukee County Land Information'],
  ['MONROE', '55081', 'Monroe County Land Information'],
  ['OCONTO', '55083', 'Oconto County Land Information'],
  ['OZAUKEE', '55089', 'Ozaukee County Land Information'],
  ['PIERCE', '55093', 'Pierce County Land Management'],
  ['RACINE', '55101', 'Racine County Real Property Listing'],
  ['SAUK', '55111', 'Sauk County Land Information'],
  ['TREMPEALEAU', '55121', 'Trempealeau County Land Records'],
  ['WAUKESHA', '55133', 'Waukesha County Land Information'],
  ['WINNEBAGO', '55139', 'Winnebago County Property Lister'],
  ['WOOD', '55141', 'Wood County Land Information']
]);

const CT_COUNTY_ENTRIES = buildStatewideCountyEntries('CT', STATEWIDE_ARCGIS_REGISTRY.CT, [
  ['FAIRFIELD', '09001', 'Fairfield County Municipal Assessors'],
  ['HARTFORD', '09003', 'Hartford County Municipal Assessors'],
  ['LITCHFIELD', '09005', 'Litchfield County Municipal Assessors'],
  ['MIDDLESEX', '09007', 'Middlesex County Municipal Assessors'],
  ['NEW HAVEN', '09009', 'New Haven County Municipal Assessors'],
  ['NEW LONDON', '09011', 'New London County Municipal Assessors'],
  ['SOUTHEASTERN CT', '09011', 'Southeastern Connecticut Municipal Assessors'],
  ['TOLLAND', '09013', 'Tolland County Municipal Assessors'],
  ['WINDHAM', '09015', 'Windham County Municipal Assessors']
]);

const AR_COUNTY_ENTRIES = buildStatewideCountyEntries('AR', STATEWIDE_ARCGIS_REGISTRY.AR, [
  ['ARKANSAS', '05001', 'Arkansas County Assessor'],
  ['BENTON', '05007', 'Benton County Assessor'],
  ['BOONE', '05009', 'Boone County Assessor'],
  ['CARROLL', '05015', 'Carroll County Assessor'],
  ['CLARK', '05019', 'Clark County Assessor'],
  ['CLAY', '05021', 'Clay County Assessor'],
  ['COLUMBIA', '05027', 'Columbia County Assessor'],
  ['CONWAY', '05029', 'Conway County Assessor'],
  ['CRAIGHEAD', '05031', 'Craighead County Assessor (Jonesboro)'],
  ['CRAWFORD', '05033', 'Crawford County Assessor'],
  ['CRITTENDEN', '05035', 'Crittenden County Assessor'],
  ['DALLAS', '05039', 'Dallas County Assessor'],
  ['FAULKNER', '05045', 'Faulkner County Assessor (Conway)'],
  ['FRANKLIN', '05047', 'Franklin County Assessor'],
  ['FULTON', '05049', 'Fulton County Assessor'],
  ['GARLAND', '05051', 'Garland County Assessor (Hot Springs)'],
  ['GREENE', '05055', 'Greene County Assessor'],
  ['HOT SPRING', '05059', 'Hot Spring County Assessor'],
  ['HOWARD', '05061', 'Howard County Assessor'],
  ['INDEPENDENCE', '05063', 'Independence County Assessor'],
  ['JACKSON', '05067', 'Jackson County Assessor'],
  ['JEFFERSON', '05069', 'Jefferson County Assessor (Pine Bluff)'],
  ['JOHNSON', '05071', 'Johnson County Assessor'],
  ['LAWRENCE', '05075', 'Lawrence County Assessor'],
  ['LEE', '05077', 'Lee County Assessor'],
  ['LINCOLN', '05079', 'Lincoln County Assessor'],
  ['LONOKE', '05085', 'Lonoke County Assessor'],
  ['MADISON', '05087', 'Madison County Assessor'],
  ['MARION', '05089', 'Marion County Assessor'],
  ['MILLER', '05091', 'Miller County Assessor'],
  ['MISSISSIPPI', '05093', 'Mississippi County Assessor'],
  ['MONTGOMERY', '05097', 'Montgomery County Assessor'],
  ['NEVADA', '05099', 'Nevada County Assessor'],
  ['OUACHITA', '05103', 'Ouachita County Assessor'],
  ['PERRY', '05105', 'Perry County Assessor'],
  ['PHILLIPS', '05107', 'Phillips County Assessor'],
  ['POINSETT', '05111', 'Poinsett County Assessor'],
  ['POPE', '05115', 'Pope County Assessor'],
  ['PRAIRIE', '05117', 'Prairie County Assessor'],
  ['PULASKI', '05119', 'Pulaski County Assessor (Little Rock)'],
  ['RANDOLPH', '05121', 'Randolph County Assessor'],
  ['SALINE', '05125', 'Saline County Assessor'],
  ['SCOTT', '05127', 'Scott County Assessor'],
  ['SEBASTIAN', '05131', 'Sebastian County Assessor (Fort Smith)'],
  ['SHARP', '05135', 'Sharp County Assessor'],
  ['ST. FRANCIS', '05123', 'St. Francis County Assessor'],
  ['ST FRANCIS', '05123', 'St. Francis County Assessor'],
  ['UNION', '05139', 'Union County Assessor'],
  ['VAN BUREN', '05141', 'Van Buren County Assessor'],
  ['WASHINGTON', '05143', 'Washington County Assessor (Fayetteville)'],
  ['WHITE', '05145', 'White County Assessor'],
  ['YELL', '05149', 'Yell County Assessor']
]);

/**
 * County ArcGIS REST FeatureServer / MapServer Registry
 * Maps county keys (e.g. "OH-CUYAHOGA", "TX-BEXAR", "FL-ORANGE") to public parcel layers.
 * County-specific endpoints take precedence over statewide composite fallbacks.
 */
const COUNTY_ARCGIS_REGISTRY = {
  ...NJ_COUNTY_ENTRIES,
  ...FL_STATEWIDE_COUNTY_ENTRIES,
  'FL-STATEWIDE': {
    name: STATEWIDE_ARCGIS_REGISTRY.FL.name,
    fips: null,
    endpoint: STATEWIDE_ARCGIS_REGISTRY.FL.endpoint,
    apnField: STATEWIDE_ARCGIS_REGISTRY.FL.apnField,
    landUseField: STATEWIDE_ARCGIS_REGISTRY.FL.landUseField,
    assessedTotalField: STATEWIDE_ARCGIS_REGISTRY.FL.assessedTotalField,
    assessedLandField: STATEWIDE_ARCGIS_REGISTRY.FL.assessedLandField,
    assessedImprvField: STATEWIDE_ARCGIS_REGISTRY.FL.assessedImprvField,
    legalDescField: STATEWIDE_ARCGIS_REGISTRY.FL.legalDescField,
    situsAddressField: STATEWIDE_ARCGIS_REGISTRY.FL.situsAddressField,
    spatialFallback: 'envelope',
    statewideService: 'FL'
  },
  ...CO_COUNTY_ENTRIES,
  ...NC_COUNTY_ENTRIES,
  ...NY_COUNTY_ENTRIES,
  ...WI_COUNTY_ENTRIES,
  ...CT_COUNTY_ENTRIES,
  ...AR_COUNTY_ENTRIES,
  'TX-BEXAR': {
    name: 'Bexar County / San Antonio (BCAD)',
    fips: '48029',
    endpoint: 'https://maps.bexar.org/arcgis/rest/services/Cadastral/Parcels/MapServer/0/query',
    apnField: 'PROP_ID',
    landUseField: 'STATE_CD',
    assessedTotalField: 'APPRAISED_VAL',
    assessedLandField: 'LAND_VAL',
    assessedImprvField: 'IMPRV_VAL',
    legalDescField: 'LEGAL_DESC'
  },
  'OH-CUYAHOGA': {
    name: 'Cuyahoga County Fiscal Officer (Cleveland)',
    fips: '39035',
    endpoint: 'https://gis.cuyahogacounty.us/arcgis/rest/services/Parcels/MapServer/0/query',
    apnField: 'PARCELPIN',
    landUseField: 'LUC_DESC',
    assessedTotalField: 'TOTAL_ASSESSED_VAL',
    assessedLandField: 'LAND_ASSESSED_VAL',
    assessedImprvField: 'BLDG_ASSESSED_VAL',
    legalDescField: 'LEGAL_DESC'
  },
  'FL-ORANGE': {
    name: 'Orange County Property Appraiser (Orlando)',
    fips: '12095',
    endpoint: 'https://ocpafl.org/arcgis/rest/services/Public/Parcels/FeatureServer/0/query',
    apnField: 'PARCEL_ID',
    landUseField: 'DOR_DESC',
    assessedTotalField: 'JUST_VAL',
    assessedLandField: 'LAND_VAL',
    assessedImprvField: 'BLDG_VAL',
    legalDescField: 'SHORT_LEGAL'
  },
  'IL-COOK': {
    name: 'Cook County Assessor (Chicago)',
    fips: '17031',
    endpoint: 'https://datacatalog.cookcountyil.gov/arcgis/rest/services/Parcels/MapServer/0/query',
    apnField: 'PIN',
    landUseField: 'CLASS_DESC',
    assessedTotalField: 'CERTIFIED_TOTAL',
    assessedLandField: 'CERTIFIED_LAND',
    assessedImprvField: 'CERTIFIED_BLDG',
    legalDescField: 'LEGAL_DESC'
  },
  'NV-CLARK': {
    name: 'Clark County Assessor (Las Vegas)',
    fips: '32003',
    endpoint: 'https://gisgate.co.clark.nv.us/arcgis/rest/services/Parcels/MapServer/0/query',
    apnField: 'PARCEL_NUM',
    landUseField: 'LU_DESC',
    assessedTotalField: 'TAX_VAL',
    assessedLandField: 'LAND_VAL',
    assessedImprvField: 'IMP_VAL',
    legalDescField: 'LEGAL'
  },
  'ID-BANNOCK': {
    name: 'Bannock County Assessor (Pocatello)',
    fips: '16005',
    endpoint: 'https://maps.bannockcounty.us/arcgis/rest/services/Parcels/MapServer/0/query',
    apnField: 'PARCELID',
    landUseField: 'PROP_CLASS',
    assessedTotalField: 'TOTAL_VAL',
    assessedLandField: 'LAND_VAL',
    assessedImprvField: 'BLDG_VAL',
    legalDescField: 'LEGAL_DESC'
  },
  'FL-ALACHUA': {
    name: 'Alachua County Property Appraiser (Gainesville)',
    fips: '12001',
    endpoint: 'https://maps.alachuacounty.us/server/rest/services/Hosted/ParcelsACGM/FeatureServer/0/query',
    apnField: 'parcel',
    landUseField: 'flucode',
    assessedTotalField: 'justvalue',
    assessedLandField: null,
    assessedImprvField: null,
    legalDescField: 'zonelink'
  },
  'TX-HARRIS': {
    name: 'Harris County Appraisal District (HCAD)',
    fips: '48201',
    endpoint: 'https://gis.hcad.org/arcgis/rest/services/Public/Parcels/MapServer/0/query',
    apnField: 'HCAD_NUM',
    landUseField: 'State_Class',
    assessedTotalField: 'Tot_Appr_Val',
    assessedLandField: 'Land_Val',
    assessedImprvField: 'Bld_Val',
    legalDescField: 'Legal_Desc'
  },
  // Endpoints below were verified live against each service's layer metadata
  // and a sampled spatial query on 2026-10-21 (see
  // reports/assessor-enrollment-2026-10-21.md). Where a lookup was verified
  // but the value semantics were not, the county is converted nowhere — see
  // WITHHOLD in server/enrichment/assessor-reading.js.
  'OH-FRANKLIN': {
    name: 'Franklin County Auditor (Columbus)',
    fips: '39049',
    endpoint: 'https://gis.franklincountyohio.gov/hosting/rest/services/ParcelFeatures/Parcel_Features/MapServer/0/query',
    apnField: 'PARCELID',
    landUseField: 'PCLASSDSCRP',
    assessedTotalField: 'TOTVALUEBASE',
    assessedLandField: 'LNDVALUEBASE',
    assessedImprvField: 'BLDVALUEBASE'
  },
  'OH-HAMILTON': {
    name: 'Hamilton County Auditor / CAGIS (Cincinnati)',
    fips: '39061',
    endpoint: 'https://cagisonline.hamilton-co.org/arcgis/rest/services/COUNTYWIDE/Cadastral/MapServer/2/query',
    apnField: 'PARCELID',
    landUseField: 'CLASS',
    assessedTotalField: 'MKT_TOTAL_VAL',
    assessedLandField: 'MKTLND',
    assessedImprvField: 'MKTIMP',
    legalDescField: 'LGLDS1',
    // Parcel centroids, not polygons: a point-intersect matches only an exact
    // centroid coordinate, so the query falls back to a small envelope
    // around the listing point.
    spatialFallback: 'envelope'
  },
  'TX-TARRANT': {
    name: 'Tarrant Appraisal District (Fort Worth public parcels)',
    fips: '48439',
    endpoint: 'https://services5.arcgis.com/3ddLCBXe1bRt7mzj/arcgis/rest/services/Parcels_Public_Vview/FeatureServer/0/query',
    apnField: 'TAXPIN',
    landUseField: 'STATE_USE_CODE',
    assessedTotalField: 'APPRAISED_VALUE',
    assessedLandField: 'LAND_VAL',
    assessedImprvField: 'IMPR_VAL',
    legalDescField: 'PARCEL_LEGAL_DESCRIPTION'
  },
  'NV-WASHOE': {
    name: 'Washoe County Assessor (Reno)',
    fips: '32031',
    endpoint: 'https://services.arcgis.com/iCGWaR7ZHc5saRIl/arcgis/rest/services/Nightly_OpenData_Update/FeatureServer/1/query',
    apnField: 'APN',
    landUseField: 'LAND_USE',
    assessedTotalField: 'TOTALASS',
    assessedLandField: 'LANDASS',
    assessedImprvField: 'BUILDASS',
    legalDescField: 'SUBNAME'
  },
  // High-volume county endpoints verified live on 2026-10-30
  'PA-PHILADELPHIA': {
    name: 'Philadelphia Office of Property Assessment (OPA)',
    fips: '42101',
    endpoint: 'https://services.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services/OPA_Properties_Public/FeatureServer/0/query',
    apnField: 'parcel_number',
    landUseField: 'category_code_description',
    assessedTotalField: 'market_value',
    assessedLandField: 'taxable_land',
    assessedImprvField: 'taxable_building',
    legalDescField: 'building_code_description',
    situsAddressField: 'location',
    spatialFallback: 'envelope'
  },
  'PA-CHESTER': {
    name: 'Chester County Assessment Office (ChescoViews)',
    fips: '42029',
    endpoint: 'https://services.arcgis.com/G4S1dGvn7PIgYd6Y/arcgis/rest/services/Parcels_owners/FeatureServer/0/query',
    apnField: 'UPI',
    landUseField: 'LUC',
    assessedTotalField: 'TOT_ASSESS',
    assessedLandField: 'LOT_ASSESS',
    assessedImprvField: 'PROP_ASSESS',
    legalDescField: 'LEGAL1',
    situsAddressField: 'LOC_ADDRESS'
  },
  'PA-BUCKS': {
    name: 'Bucks County Board of Assessment',
    fips: '42017',
    endpoint: 'https://services3.arcgis.com/SP47Tddf7RK32lBU/arcgis/rest/services/Bucks_County_Parcels/FeatureServer/0/query',
    apnField: 'PARCEL_NUM',
    landUseField: 'LAND_USE_CODE',
    assessedTotalField: 'TOTAL_VALUE',
    assessedLandField: 'LAND_VALUE',
    assessedImprvField: 'BUILDING_VALUE',
    legalDescField: 'MUNICIPALITY',
    situsAddressField: 'ADDRESS'
  },
  'PA-BERKS': {
    name: 'Berks County Assessment Office',
    fips: '42011',
    endpoint: 'https://services3.arcgis.com/dGYe1jDYrTw1wwpc/arcgis/rest/services/Berks_County_Parcels/FeatureServer/0/query',
    apnField: 'PROPID',
    landUseField: 'LANDUSE',
    assessedTotalField: 'VALUTOTAL',
    assessedLandField: 'VALULAND',
    assessedImprvField: 'VALUBLDG',
    legalDescField: 'DESCR1',
    situsAddressField: 'FULLSITEADDRESS'
  },
  'MI-WAYNE': {
    name: 'Wayne County / City of Detroit Office of the Assessor',
    fips: '26163',
    endpoint: 'https://services2.arcgis.com/PpbvckyUgaYqseNQ/arcgis/rest/services/Detroit_MP_Parcel_Authoritative/FeatureServer/0/query',
    apnField: 'parcel_id',
    landUseField: 'property_class_description',
    assessedTotalField: 'amt_assessed_value',
    assessedLandField: null,
    assessedImprvField: null,
    legalDescField: 'legal_description',
    situsAddressField: 'address'
  },
  'OH-SUMMIT': {
    name: 'Summit County Fiscal Office (Akron)',
    fips: '39153',
    endpoint: 'https://services3.arcgis.com/3Ukh5HzAdI6WZ3KP/arcgis/rest/services/Parcels_07162026/FeatureServer/0/query',
    apnField: 'parcelid',
    landUseField: 'classdscrp',
    assessedTotalField: 'cntmarval',
    assessedLandField: 'lndvalue',
    assessedImprvField: 'bldgvalue',
    legalDescField: 'prprtydscrp',
    situsAddressField: 'siteaddress'
  },
  'OH-STARK': {
    name: 'Stark County Auditor (Canton)',
    fips: '39151',
    endpoint: 'https://scgisa.starkcountyohio.gov/arcgis/rest/services/Auditor/StarkCountyParcels/MapServer/0/query',
    apnField: 'PIN',
    landUseField: 'LAND_USE_DESCRIPTION',
    assessedTotalField: 'APPRAISED_TOTAL_VALUE',
    assessedLandField: 'APPRAISED_LAND_VALUE',
    assessedImprvField: 'APPRAISED_BUILDING_VALUE',
    legalDescField: 'LEGAL_DESCRIPTION',
    situsAddressField: 'SITE_ADDRESS'
  },
  'OH-MONTGOMERY': {
    name: 'Montgomery County Auditor (Dayton)',
    fips: '39113',
    endpoint: 'https://gis.mcohio.org/arcgis/rest/services/AUDGIS/AUDGIS_Advance/MapServer/0/query',
    apnField: 'PARCELID',
    landUseField: 'LUC_DESC',
    assessedTotalField: 'MKT_TOTAL_VAL',
    assessedLandField: 'MKT_LAND_VAL',
    assessedImprvField: 'MKT_BLDG_VAL',
    legalDescField: 'LEGAL_DESC',
    situsAddressField: 'SITUS_ADDRESS'
  },
  'OH-LAKE': {
    name: 'Lake County Auditor (Painesville)',
    fips: '39085',
    endpoint: 'https://gis.lakecountyohio.gov/arcgis/rest/services/Sharing/LCGIS_SHARE_2023/FeatureServer/0/query',
    apnField: 'PIN',
    landUseField: 'A_PROP_CLASS',
    assessedTotalField: 'A_VAL_TOTAL',
    assessedLandField: 'A_VAL_LAND',
    assessedImprvField: 'A_VAL_BLDG',
    legalDescField: 'A_LEGAL_DESC',
    situsAddressField: 'G_FULLADDRESS'
  },
  'FL-PALMBEACH': {
    name: 'Palm Beach County Property Appraiser (PAPA)',
    fips: '12099',
    endpoint: 'https://services1.arcgis.com/ZWOoUZbtaYePLlPw/arcgis/rest/services/Parcels_and_Property_Details_WebMercator/FeatureServer/0/query',
    apnField: 'PARCEL_NUMBER',
    landUseField: 'PROPERTY_USE',
    assessedTotalField: 'TOTAL_MARKET',
    assessedLandField: 'LAND_MARKET',
    assessedImprvField: 'IMPRV_MRKT',
    legalDescField: 'LEGAL1',
    situsAddressField: 'SITE_ADDR_STR'
  },
  'FL-PALM BEACH': {
    name: 'Palm Beach County Property Appraiser (PAPA)',
    fips: '12099',
    endpoint: 'https://services1.arcgis.com/ZWOoUZbtaYePLlPw/arcgis/rest/services/Parcels_and_Property_Details_WebMercator/FeatureServer/0/query',
    apnField: 'PARCEL_NUMBER',
    landUseField: 'PROPERTY_USE',
    assessedTotalField: 'TOTAL_MARKET',
    assessedLandField: 'LAND_MARKET',
    assessedImprvField: 'IMPRV_MRKT',
    legalDescField: 'LEGAL1',
    situsAddressField: 'SITE_ADDR_STR'
  },
  'FL-PINELLAS': {
    name: 'Pinellas County Property Appraiser (PCPAO)',
    fips: '12103',
    endpoint: 'https://services.arcgis.com/f5HgUpxURgEzTccH/arcgis/rest/services/Pinellas_ParcelPropertyInfo/FeatureServer/0/query',
    apnField: 'PARCELID',
    landUseField: 'PROPERTY_USE',
    assessedTotalField: 'CNTY_TAXABLE_VALUE',
    assessedLandField: 'JUST_LAND',
    assessedImprvField: 'JUST_BUILDING',
    legalDescField: 'LEGAL',
    situsAddressField: 'SITE_ADDRESS'
  },
  'FL-BREVARD': {
    name: 'Brevard County Property Appraiser (BCPAO)',
    fips: '12009',
    endpoint: 'https://gis.brevardfl.gov/gissrv/rest/services/Base_Map/Parcel_New_WKID2881/MapServer/5/query',
    apnField: 'PARCEL_ID',
    landUseField: 'USE_CODE_DESCRIPTION',
    assessedTotalField: null,
    assessedLandField: 'LAND_VALUE',
    assessedImprvField: 'BLDG_VALUE',
    legalDescField: 'LEGAL_DESC',
    situsAddressField: 'STREET_NAME',
    sumLandAndImprvForTotal: true
  },
  'GA-DEKALB': {
    name: 'DeKalb County Property Appraisal (Atlanta Metro)',
    fips: '13089',
    endpoint: 'https://services2.arcgis.com/IxVN2oUE9EYLSnPE/arcgis/rest/services/Tax_Parcels_2025/FeatureServer/0/query',
    apnField: 'ParcelID',
    landUseField: 'PROPERTY_CLASS',
    assessedTotalField: 'APPRAISED_VALUE',
    assessedLandField: 'LAND_VALUE',
    assessedImprvField: 'BLDG_VALUE',
    legalDescField: 'LANDUSE'
  },
  'CA-SAN BERNARDINO': {
    name: 'San Bernardino County Assessor-Recorder-County Clerk',
    fips: '06071',
    endpoint: 'https://services.arcgis.com/aA3snZwJfFkVyDuP/arcgis/rest/services/Parcels_for_San_Bernardino_County/FeatureServer/0/query',
    apnField: 'ParcelNumber',
    landUseField: 'AssessClass',
    assessedTotalField: null,
    assessedLandField: 'LandValue',
    assessedImprvField: 'ImprovementValue',
    legalDescField: 'ZoningDescription',
    sumLandAndImprvForTotal: true
  },
  'WA-PIERCE': {
    name: 'Pierce County Assessor-Treasurer (Tacoma)',
    fips: '53053',
    endpoint: 'https://services2.arcgis.com/1UvBaQ5y1ubjUPmd/arcgis/rest/services/Tax_Parcels/FeatureServer/0/query',
    apnField: 'TaxParcelNumber',
    landUseField: 'Landuse_Description',
    assessedTotalField: 'Taxable_Value',
    assessedLandField: 'Land_Value',
    assessedImprvField: 'Improvement_Value',
    legalDescField: 'Legal_Description',
    situsAddressField: 'Site_Address'
  },
  'AL-JEFFERSON': {
    name: 'Jefferson County Board of Equalization / Tax Assessor (Birmingham)',
    fips: '01073',
    endpoint: 'https://jccgis.jccal.org/server/rest/services/Basemap/Parcels/MapServer/0/query',
    apnField: 'PARCELID',
    landUseField: 'Cls',
    assessedTotalField: 'PrevParcelTotal',
    assessedLandField: 'PrevParcelLand',
    assessedImprvField: 'PrevParcelImp',
    legalDescField: 'Legal_Desc',
    situsAddressField: 'ADDR_PSPR'
  },
  'MN-HENNEPIN': {
    name: 'Hennepin County Assessor / MetroGIS (Minneapolis)',
    fips: '27053',
    endpoint: 'https://arcgis.metc.state.mn.us/data1/rest/services/parcels/Parcels/FeatureServer/3/query',
    apnField: 'COUNTY_PIN',
    landUseField: 'USECLASS1',
    assessedTotalField: 'EMV_TOTAL',
    assessedLandField: 'EMV_LAND',
    assessedImprvField: 'EMV_BLDG',
    legalDescField: 'ABB_LEGAL',
    situsAddressField: 'ST_NAME'
  },
  'MN-RAMSEY': {
    name: 'Ramsey County Assessor / MetroGIS (St. Paul)',
    fips: '27123',
    endpoint: 'https://arcgis.metc.state.mn.us/data1/rest/services/parcels/Parcels/FeatureServer/4/query',
    apnField: 'COUNTY_PIN',
    landUseField: 'USECLASS1',
    assessedTotalField: 'EMV_TOTAL',
    assessedLandField: 'EMV_LAND',
    assessedImprvField: 'EMV_BLDG',
    legalDescField: 'ABB_LEGAL',
    situsAddressField: 'ST_NAME'
  },
  'MN-DAKOTA': {
    name: 'Dakota County Assessing Services / MetroGIS',
    fips: '27037',
    endpoint: 'https://arcgis.metc.state.mn.us/data1/rest/services/parcels/Parcels/FeatureServer/2/query',
    apnField: 'COUNTY_PIN',
    landUseField: 'USECLASS1',
    assessedTotalField: 'EMV_TOTAL',
    assessedLandField: 'EMV_LAND',
    assessedImprvField: 'EMV_BLDG',
    legalDescField: 'ABB_LEGAL',
    situsAddressField: 'ST_NAME'
  },
  'MN-ANOKA': {
    name: 'Anoka County Property Records & Taxation / MetroGIS',
    fips: '27003',
    endpoint: 'https://arcgis.metc.state.mn.us/data1/rest/services/parcels/Parcels/FeatureServer/0/query',
    apnField: 'COUNTY_PIN',
    landUseField: 'USECLASS1',
    assessedTotalField: 'EMV_TOTAL',
    assessedLandField: 'EMV_LAND',
    assessedImprvField: 'EMV_BLDG',
    legalDescField: 'ABB_LEGAL',
    situsAddressField: 'ST_NAME'
  },
  'MN-WASHINGTON': {
    name: 'Washington County Assessment Services / MetroGIS',
    fips: '27163',
    endpoint: 'https://arcgis.metc.state.mn.us/data1/rest/services/parcels/Parcels/FeatureServer/6/query',
    apnField: 'COUNTY_PIN',
    landUseField: 'USECLASS1',
    assessedTotalField: 'EMV_TOTAL',
    assessedLandField: 'EMV_LAND',
    assessedImprvField: 'EMV_BLDG',
    legalDescField: 'ABB_LEGAL',
    situsAddressField: 'ST_NAME'
  },
  'MN-SCOTT': {
    name: 'Scott County Taxation / MetroGIS',
    fips: '27139',
    endpoint: 'https://arcgis.metc.state.mn.us/data1/rest/services/parcels/Parcels/FeatureServer/5/query',
    apnField: 'COUNTY_PIN',
    landUseField: 'USECLASS1',
    assessedTotalField: 'EMV_TOTAL',
    assessedLandField: 'EMV_LAND',
    assessedImprvField: 'EMV_BLDG',
    legalDescField: 'ABB_LEGAL',
    situsAddressField: 'ST_NAME'
  },
  'MN-CARVER': {
    name: 'Carver County Property Assessing / MetroGIS',
    fips: '27019',
    endpoint: 'https://arcgis.metc.state.mn.us/data1/rest/services/parcels/Parcels/FeatureServer/1/query',
    apnField: 'COUNTY_PIN',
    landUseField: 'USECLASS1',
    assessedTotalField: 'EMV_TOTAL',
    assessedLandField: 'EMV_LAND',
    assessedImprvField: 'EMV_BLDG',
    legalDescField: 'ABB_LEGAL',
    situsAddressField: 'ST_NAME'
  },
  'UT-SALT LAKE': {
    name: 'Salt Lake County Assessor (Utah AGRC LIR)',
    fips: '49035',
    endpoint: 'https://services1.arcgis.com/99lidPhWCzftIe9K/arcgis/rest/services/Parcels_SaltLake_LIR/FeatureServer/0/query',
    apnField: 'PARCEL_ID',
    landUseField: 'PROP_CLASS',
    assessedTotalField: 'TOTAL_MKT_VALUE',
    assessedLandField: 'LAND_MKT_VALUE',
    assessedImprvField: null,
    legalDescField: 'SUBDIV_NAME',
    situsAddressField: 'PARCEL_ADD'
  },
  'UT-UTAH': {
    name: 'Utah County Assessor (Provo / Utah AGRC LIR)',
    fips: '49049',
    endpoint: 'https://services1.arcgis.com/99lidPhWCzftIe9K/arcgis/rest/services/Parcels_Utah_LIR/FeatureServer/0/query',
    apnField: 'PARCEL_ID',
    landUseField: 'PROP_CLASS',
    assessedTotalField: 'TOTAL_MKT_VALUE',
    assessedLandField: 'LAND_MKT_VALUE',
    assessedImprvField: null,
    legalDescField: 'SUBDIV_NAME',
    situsAddressField: 'PARCEL_ADD'
  },
  'UT-WEBER': {
    name: 'Weber County Assessor (Ogden / Utah AGRC LIR)',
    fips: '49057',
    endpoint: 'https://services1.arcgis.com/99lidPhWCzftIe9K/arcgis/rest/services/Parcels_Weber_LIR/FeatureServer/0/query',
    apnField: 'PARCEL_ID',
    landUseField: 'PROP_CLASS',
    assessedTotalField: 'TOTAL_MKT_VALUE',
    assessedLandField: 'LAND_MKT_VALUE',
    assessedImprvField: null,
    legalDescField: 'SUBDIV_NAME',
    situsAddressField: 'PARCEL_ADD'
  },
  'UT-DAVIS': {
    name: 'Davis County Assessor (Utah AGRC LIR)',
    fips: '49011',
    endpoint: 'https://services1.arcgis.com/99lidPhWCzftIe9K/arcgis/rest/services/Parcels_Davis_LIR/FeatureServer/0/query',
    apnField: 'PARCEL_ID',
    landUseField: 'PROP_CLASS',
    assessedTotalField: 'TOTAL_MKT_VALUE',
    assessedLandField: 'LAND_MKT_VALUE',
    assessedImprvField: null,
    legalDescField: 'SUBDIV_NAME',
    situsAddressField: 'PARCEL_ADD'
  }
};

const COUNTY_ARCGIS_ENDPOINTS = COUNTY_ARCGIS_REGISTRY;

/**
 * Normalizes county and state into a registry key (e.g. "TX-BEXAR") or a
 * statewide fallback key when the state publishes a statewide parcel roll.
 */
function resolveCountyKey(state, county) {
  if (!state) return null;
  const st = String(state).trim().toUpperCase();
  const co = county
    ? String(county)
        .trim()
        .toUpperCase()
        .replace(/[^\x20-\x7E]/g, '')
        .replace(/\s+(COUNTY|PARISH|BOROUGH|MUNICIPALITY|CITY AND COUNTY)$/i, '')
        .replace(/\s+/g, ' ')
        .trim()
    : '';
  if (co && co !== 'COUNTY UNKNOWN' && co !== 'UNKNOWN' && co !== 'NA' && co !== 'N/A') {
    const exactKey = `${st}-${co}`;
    if (COUNTY_ARCGIS_REGISTRY[exactKey]) return exactKey;
    const dotLess = `${st}-${co.replace(/\./g, '')}`;
    if (COUNTY_ARCGIS_REGISTRY[dotLess]) return dotLess;
    const saintNormalized = `${st}-${co.replace(/^SAINT\s+/, 'ST. ')}`;
    if (COUNTY_ARCGIS_REGISTRY[saintNormalized]) return saintNormalized;
    const hyphenNormalized = `${st}-${co.replace(/\s+/g, '-')}`;
    if (COUNTY_ARCGIS_REGISTRY[hyphenNormalized]) return hyphenNormalized;
  }
  return null;
}

/**
 * Resolves the ArcGIS endpoint configuration for a given state and county,
 * falling back to the statewide ArcGIS parcel service when available.
 */
function resolveCountyEndpoint(state, county) {
  const key = resolveCountyKey(state, county);
  if (key && COUNTY_ARCGIS_REGISTRY[key]) {
    return { key, ...COUNTY_ARCGIS_REGISTRY[key] };
  }
  if (!state) return null;
  const st = String(state).trim().toUpperCase();
  const statewide = STATEWIDE_ARCGIS_REGISTRY[st];
  if (statewide) {
    return {
      key: `${st}-STATEWIDE`,
      name: statewide.name,
      fips: null,
      ...statewide,
      statewideService: st
    };
  }
  return null;
}

/**
 * Normalizes an APN by removing non-alphanumeric punctuation.
 */
function normalizeApn(apn) {
  if (!apn || typeof apn !== 'string') return '';
  return apn.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

/**
 * Reads attribute property case-insensitively from ArcGIS feature attributes.
 * Supports a single field name or an array of candidate alias field names.
 */
function getAttributeCaseInsensitive(attributes, fieldName) {
  if (!attributes || !fieldName) return undefined;
  if (Array.isArray(fieldName)) {
    for (const candidate of fieldName) {
      const val = getAttributeCaseInsensitive(attributes, candidate);
      if (val !== undefined && val !== null && val !== '') return val;
    }
    return undefined;
  }
  if (attributes[fieldName] !== undefined) return attributes[fieldName];
  const upper = String(fieldName).toUpperCase();
  const lower = String(fieldName).toLowerCase();
  if (attributes[upper] !== undefined) return attributes[upper];
  if (attributes[lower] !== undefined) return attributes[lower];
  for (const [k, v] of Object.entries(attributes)) {
    if (k.toUpperCase() === upper) return v;
  }
  return undefined;
}

/**
 * Parses numeric currency/valuation fields cleanly, stripping commas or currency symbols
 * when a county layer formats numeric strings (e.g. "78,030"), while returning NaN for empty/null.
 */
function parseNumericAttribute(rawVal) {
  if (rawVal === null || rawVal === undefined || rawVal === '') return NaN;
  if (typeof rawVal === 'number') return Number.isFinite(rawVal) && rawVal >= 0 ? rawVal : NaN;
  const cleaned = String(rawVal).replace(/[$,\s]/g, '').trim();
  if (!cleaned) return NaN;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

/**
 * Extracts a 5-digit county FIPS from feature attributes when a statewide layer
 * carries county FIPS columns (e.g. stcntyfips, countyFips, PARCELFIPS, countyfips).
 */
function resolveFeatureCountyFips(attributes, config) {
  if (config.fips && /^\d{5}$/.test(String(config.fips))) {
    return String(config.fips);
  }
  const directFips5 = getAttributeCaseInsensitive(attributes, ['stcntyfips', 'COUNTY_FIPS', 'FIPS']);
  if (directFips5) {
    const str = String(directFips5).trim();
    if (/^\d{5}$/.test(str)) return str;
    if (/^\d{5}\d+$/.test(str)) return str.slice(0, 5);
  }
  const fips3 = getAttributeCaseInsensitive(attributes, ['countyFips', 'cntyfips', 'PARCELFIPS', 'countyfips']);
  if (fips3 && config.stateFips) {
    const str = String(fips3).trim().padStart(3, '0');
    if (/^\d{3}$/.test(str)) return `${config.stateFips}${str}`;
  }
  return config.fips || null;
}

/**
 * Normalizes raw ArcGIS parcel attributes into standard domain shape.
 * Never fabricates or imputes missing valuations; only maps genuine assessor roll fields
 * or sums explicit land + improvement components when configured.
 */
function normalizeArcgisAttributes(attributes, config) {
  if (!attributes || !config) return null;

  const rawApn = String(getAttributeCaseInsensitive(attributes, config.apnField) || '').trim();
  const canonicalApn = normalizeApn(rawApn);

  const rawTotal = parseNumericAttribute(getAttributeCaseInsensitive(attributes, config.assessedTotalField));
  const rawLand = parseNumericAttribute(getAttributeCaseInsensitive(attributes, config.assessedLandField));
  const rawImprv = parseNumericAttribute(getAttributeCaseInsensitive(attributes, config.assessedImprvField));

  const land = Number.isFinite(rawLand) ? rawLand : null;
  const improvements = Number.isFinite(rawImprv) ? rawImprv : null;
  let total = Number.isFinite(rawTotal) ? rawTotal : null;

  if ((total === null || total <= 0) && config.sumLandAndImprvForTotal) {
    const l = (land !== null && land >= 0) ? land : 0;
    const imp = (improvements !== null && improvements >= 0) ? improvements : 0;
    if (l > 0 || imp > 0) {
      total = l + imp;
    }
  }

  const situsRaw = config.situsAddressField
    ? getAttributeCaseInsensitive(attributes, config.situsAddressField)
    : undefined;
  const situsAddress = situsRaw ? String(situsRaw).replace(/\s+/g, ' ').trim() : '';

  return {
    source: 'ARCGIS_REST_PARCEL',
    countyFips: resolveFeatureCountyFips(attributes, config),
    countyName: config.name,
    rawApn,
    canonicalApn,
    situsAddress: situsAddress || null,
    landUse: String(getAttributeCaseInsensitive(attributes, config.landUseField) || 'UNKNOWN').trim(),
    legalDescription: String(getAttributeCaseInsensitive(attributes, config.legalDescField) || '').trim(),
    assessedValue: {
      total,
      land,
      improvements
    },
    rawAttributes: attributes
  };
}

const normalizeParcelAttributes = normalizeArcgisAttributes;

/**
 * Selects the nearest feature when an envelope fallback returns multiple point features
 * and feature geometries are included, otherwise returns the first feature.
 */
function selectBestFeature(features, lat, lng) {
  if (!Array.isArray(features) || !features.length) return null;
  if (features.length === 1 || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return features[0];
  }
  let best = features[0];
  let bestDist = Infinity;
  for (const feature of features) {
    const geom = feature && feature.geometry;
    if (geom && Number.isFinite(Number(geom.x)) && Number.isFinite(Number(geom.y))) {
      const dist = Math.hypot(Number(geom.x) - lng, Number(geom.y) - lat);
      if (dist < bestDist) {
        bestDist = dist;
        best = feature;
      }
    }
  }
  return best;
}

/**
 * Queries an ArcGIS FeatureServer/MapServer for a parcel by coordinates or APN.
 *
 * @param {Object} params
 * @param {number} [params.lat] - Latitude
 * @param {number} [params.lng] - Longitude
 * @param {string} [params.apn] - Parcel identification number
 * @param {string} params.state - Two-letter state code (e.g. 'TX')
 * @param {string} params.county - County name (e.g. 'Bexar')
 * @param {Function} [params.fetchFn] - Custom fetch for testing
 * @returns {Promise<Object|null>}
 */
async function queryArcgisParcel(params = {}, init = {}) {
  const options = (typeof params === 'object' && params !== null) ? params : {};
  const { lat, lng, apn, state, county, fetchFn = globalThis.fetch } = options;

  const resolved = resolveCountyEndpoint(state, county);
  const countyFips = options.countyFips || (resolved && resolved.fips) || null;
  if (apn) {
    const localHit = queryLocalParcelIndex({ apn, countyFips, state, county });
    if (localHit) return localHit;
  }
  const signal = (options && options.signal) || (init && init.signal) || AbortSignal.timeout(8000);

  if (!resolved) {
    return null; // County and state not yet mapped in registry
  }

  const config = COUNTY_ARCGIS_REGISTRY[resolved.key] || resolved;
  let queryParams = new URLSearchParams({
    outFields: '*',
    f: 'json',
    returnGeometry: 'false'
  });

  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    // Spatial point intersection
    queryParams.set('geometry', `${lng},${lat}`);
    queryParams.set('geometryType', 'esriGeometryPoint');
    queryParams.set('spatialRel', 'esriSpatialRelIntersects');
    queryParams.set('inSR', '4326');
    queryParams.set('returnGeometry', 'true');
  } else if (apn) {
    // APN attribute search
    const clean = normalizeApn(apn);
    if (!clean) return null;
    let whereClause = `UPPER(${config.apnField}) LIKE '%${clean}%'`;
    if (config.countyFilterField && county) {
      const cleanCounty = String(county)
        .trim()
        .toUpperCase()
        .replace(/\s+(COUNTY|PARISH)$/i, '')
        .replace(/['’]/g, '')
        .replace(/--+/g, '')
        .replace(/[^A-Z0-9 .]/g, '')
        .trim();
      if (cleanCounty) {
        whereClause = `UPPER(${config.countyFilterField}) LIKE '%${cleanCounty}%' AND (${whereClause})`;
      }
    }
    queryParams.set('where', whereClause);
  } else {
    return null;
  }

  const url = `${config.endpoint}?${queryParams.toString()}`;

  try {
    const res = await fetchFn(url, { signal,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'PropertyCrawl/2.0 (ArcGIS Open Parcel Gateway)'
      }
    });

    if (!res.ok) return null;

    const data = await res.json();
    let features = data && Array.isArray(data.features) ? data.features : [];

    // Centroid-point layers (spatialFallback: 'envelope') cannot be matched by
    // an exact point-intersect — the listing coordinate is not the parcel's
    // centroid. Retry once with a ~44 m envelope around the same point, which
    // matches the parcel whose centroid is nearest without drifting into a
    // neighboring parcel's catchment. Bounded to one retry.
    if (!features.length && config.spatialFallback === 'envelope' && Number.isFinite(lat) && Number.isFinite(lng)) {
      const delta = 0.0004;
      queryParams.set('geometry', `${lng - delta},${lat - delta},${lng + delta},${lat + delta}`);
      queryParams.set('geometryType', 'esriGeometryEnvelope');
      queryParams.set('returnGeometry', 'true');
      const retry = await fetchFn(`${config.endpoint}?${queryParams.toString()}`, { signal,
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'PropertyCrawl/2.0 (ArcGIS Open Parcel Gateway)'
        }
      });
      if (retry.ok) {
        const retryData = await retry.json();
        features = retryData && Array.isArray(retryData.features) ? retryData.features : [];
      }
    }

    const validFeatures = features.filter((f) => f && typeof f === 'object' && f.attributes);
    if (!validFeatures.length) {
      return null;
    }

    const feature = selectBestFeature(validFeatures, lat, lng);
    return normalizeArcgisAttributes(feature.attributes, config);
  } catch (err) {
    return null;
  }
}

const queryCountyParcel = queryArcgisParcel;

/**
 * Resolves a canonical parcel identity (countyFips + canonicalApn + parcelKey)
 * via county cadastral point-in-polygon or APN lookup when an ArcGIS parcel
 * layer is available for the listing's county.
 */
async function resolveCadastralParcelIdentity(rawListing = {}, options = {}) {
  const listing = rawListing && typeof rawListing === 'object' ? rawListing : {};
  const existingApn = listing.apn || listing.parcelNumber || listing.parcelId || listing.provenance?.parcelNumber || null;
  const parcel = await queryArcgisParcel({
    lat: listing.lat !== null && listing.lat !== undefined && listing.lat !== '' ? Number(listing.lat) : NaN,
    lng: listing.lng !== null && listing.lng !== undefined && listing.lng !== '' ? Number(listing.lng) : NaN,
    apn: existingApn,
    state: listing.state,
    county: listing.county,
    fetchFn: options.fetchFn,
  });
  if (!parcel || !parcel.canonicalApn) return null;
  const parcelKey = parcel.countyFips
    ? `${parcel.countyFips}-${parcel.canonicalApn}`
    : parcel.canonicalApn;
  return {
    countyFips: parcel.countyFips || null,
    rawApn: parcel.rawApn,
    canonicalApn: parcel.canonicalApn,
    parcelKey,
    situsAddress: parcel.situsAddress || null,
    matchBasis: listing.lat !== null && listing.lat !== undefined && listing.lat !== '' && Number.isFinite(Number(listing.lat)) && listing.lng !== null && listing.lng !== undefined && listing.lng !== '' && Number.isFinite(Number(listing.lng))
      ? 'cadastral_point_in_polygon'
      : 'cadastral_apn_lookup',
    parcel,
  };
}

module.exports = {
  COUNTY_ARCGIS_REGISTRY,
  COUNTY_ARCGIS_ENDPOINTS,
  STATEWIDE_ARCGIS_REGISTRY,
  resolveCountyKey,
  resolveCountyEndpoint,
  normalizeApn,
  normalizeArcgisAttributes,
  normalizeParcelAttributes,
  selectBestFeature,
  parseNumericAttribute,
  queryArcgisParcel,
  queryCountyParcel,
  resolveCadastralParcelIdentity
};
