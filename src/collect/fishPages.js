// The fish pages to download.
//
// Category:Fish on the wiki holds only the overview page "Fish", so the list
// below was read from the tables on that page (revision 195502, saved
// 2026-11-16): rod fish, Night Market fish, legendary fish and crab pot fish.
// Its "Other Catchables" (Seaweed, algae, jellies) are left out, because
// the page says they are not counted as fish.
//
// The wiki's API returns at most 50 pages per request, hence two groups.

export const FISH_PAGE_GROUPS = [
  [
    'Pufferfish', 'Anchovy', 'Tuna', 'Sardine', 'Bream', 'Largemouth Bass', 'Smallmouth Bass',
    'Rainbow Trout', 'Salmon', 'Walleye', 'Perch', 'Carp', 'Catfish', 'Pike', 'Sunfish', 'Red Mullet',
    'Herring', 'Eel', 'Octopus', 'Red Snapper', 'Squid', 'Sea Cucumber', 'Super Cucumber', 'Ghostfish',
    'Stonefish', 'Ice Pip', 'Lava Eel', 'Sandfish', 'Scorpion Carp', 'Flounder', 'Midnight Carp',
    'Sturgeon', 'Tiger Trout', 'Bullhead', 'Tilapia', 'Chub', 'Dorado', 'Albacore', 'Shad', 'Lingcod',
    'Halibut', 'Woodskip', 'Void Salmon', 'Slimejack', 'Stingray', 'Lionfish', 'Blue Discus', 'Goby',
  ],
  [
    'Midnight Squid', 'Spook Fish', 'Blobfish',
    'Crimsonfish', 'Angler', 'Legend', 'Glacierfish', 'Mutant Carp',
    'Son of Crimsonfish', 'Ms. Angler', 'Legend II', 'Glacierfish Jr.', 'Radioactive Carp',
    'Clam', 'Lobster', 'Crayfish', 'Crab', 'Cockle', 'Mussel', 'Shrimp', 'Snail', 'Periwinkle', 'Oyster',
  ],
];
