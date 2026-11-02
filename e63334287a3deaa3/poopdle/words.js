/*
 * Poopdle's word list: four-letter English words, lower case, one list of everyday words and one of rarer ones.
 * Everyday words can be the day's start word and are the only ones hints suggest; rarer words are accepted as steps
 * too (and count when working out par, so nobody can beat it). Built once from the English word lists of
 * sindresorhus/word-list (MIT) and pyspellchecker (MIT), ranked by how often each word is used (wordfreq), then checked
 * by hand: no names or abbreviations, and nothing rude, mean or grown-up (the poo words are the joke and stay).
 * Changing either list changes future daily puzzles, so add or remove words rarely.
 */
var POOPDLE_WORDS = {
common: `
abet able ably aced aces ache achy acid acme acne acre acts adds afar aged ages agog ahem ahoy aide aims airs airy
ajar akin alas ally alms aloe alps also alto amen amid ammo amps anew ante ants apes apex apps aqua arch arcs area
argh aria arid arks arms army arts arty asks atom atop aunt aura auto avid away awed awls awry axed axes axis axle
baas babe baby back bags bail bait bake bald bale ball balm band bane bang bank bans barb bard bare barf bark barn
bars base bash bask bass bath bats bawl bays bead beak beam bean bear beat beau beds beef been beep beer bees beet
begs bell belt bend bent best beta bets bias bibs bids bike bile bill bind bins bios bird bite bits blab blah bled
blew blip blob bloc blog blot blow blue blur boar boas boat bobs body bogs boil bold bolt bomb bond bone bony book
boom boon boos boot bops bore born boss both bots bout bowl bows boxy boys brag bran brat bray bred brew brie brim
brow buck buds buff bugs bulb bulk bull bump bunk buns bunt buoy burn burp bury bush bust busy butt buys buzz byte
cabs cafe cage cake calf call calm came camp cams cane cans cape caps carb card care carp cars cart case cash cask
cast cats cave caws cell cent chai chap char chat chef chew chic chin chip chop chow chug chum cite city clad clam
clan clap claw clay clef clip clod clog clop clot club clue coal coat coax cobs code cogs coil coin cola cold colt
coma comb come cone cons cook cool coop coos coot cope cops copy cord core cork corn cost cots coup cove cowl cows
cozy crab crag cram crew crib croc crop crow crux cube cubs cued cues cuff cull cult cups curb curd cure curl curt
cusp cute cuts cyst czar dabs dada dads daft dale dame damp dams dank dare dark darn dart dash data date dawn days
daze dead deaf deal dean dear debt deck deed deem deep deer deft defy deli demo dens dent deny desk dews dewy dial
dibs dice died dies diet digs dill dime dims dine ding dips dire dirt disc dish disk diva dive dock docs dodo does
doff dogs dojo dole doll dolt dome done dons doom door dorm dose doth dots dove down doze drab drag dram drat draw
drew drip drop drug drum dual dubs duck duct dude duds duel dues duet duke dull duly dumb dump dune dunk duos dupe
dusk dust duty dyed dyes each earl earn ears ease east easy eats eave ebbs echo eddy edge edgy edit eels eggs eggy
egos elks elms else emit emus ends envy eons epic eras ergo errs etch even ever eves evil ewes exam exes exit eyed
eyes face fact fade fads fail fair fake fall fame fang fans fare farm fart fast fate fats faux fawn faze fear feat
feed feel fees feet fell felt fend fern fest feta feud fibs fife figs file fill film find fine fins fire firm firs
fish fist fits five fizz flab flag flak flan flap flat flaw flax flea fled flee flew flex flip flit floe flog flop
flow flux foal foam foes fogs foil fold folk fond font food fool foot ford fore fork form fort foul four fowl foxy
fray free fret frog from fuel full fume fund funk furs fury fuse fuss fuzz gabs gags gain gait gala gale gall gals
game gang gape gaps garb gash gasp gate gave gawk gaze gear geek geez gels gems gene gent germ gets gift gigs gill
gilt girl gist give glad glee glen glob glow glue glum glut gnat gnaw gnus goal goat goby gods goes gold golf gone
gong good goof goon goop gory gosh gout gown grab grad gram gray grew grey grid grim grin grip grit grow grub gulf
gull gulp gums gunk guns guru gush gust guts guys gyms hack hail hair hale half hall halo halt hams hand hang hard
hare harm harp hash hast hate hath hats haul have hawk hays haze hazy head heal heap hear heat heck heed heel heir
held helm help hems hens herb herd here hero hers hide high hike hill hilt hint hips hire hiss hits hive hoax hoed
hogs hold hole holy home hone honk hood hoof hook hoop hoot hope hops horn hose host hour howl hubs hues huff huge
hugs hula hulk hull hums hung hunt hurl hurt hush husk huts hymn hype ibex iced ices icky icon idea idle idly idol
ills imps inch inks inky inns into ions iota iris irks iron isle itch item jabs jack jade jail jams jars jaws jays
jazz jean jeep jeer jeez jerk jest jets jigs jinx jobs joey jogs join joke jolt jowl joys judo jugs jump junk jury
just jute juts kale kart keel keen keep kegs kelp kept keys kick kids kill kiln kilo kilt kind king kiss kite kits
kiwi knee knew knit knob knot know kudu labs lace lack lacy lads lady lags laid lain lair lake lamb lame lamp land
lane laps lard lark lash lass last late lava lawn laws lays laze lazy lead leaf leak lean leap leek left legs lend
lens lent less lest lets levy liar lice lick lids lied lien lies life lift like lily limb lime limo limp line link
lint lion lips lisp list live load loaf loan lobe lobs loch lock loft logo logs loin lone long look loom loon loop
loot lops lord lore lose loss lost lots loud lout love lows luau luck lugs lull lump lung lure lurk lush lute luxe
lynx lyre mace made mage mags maid mail main make male mall malt mama mane mans many maps mare mark mart mash mask
mass mast mate math mats maul maxi mayo maze meal mean meat meds meek meet mega melt meme memo mend menu meow mere
mesh mess mews mica mice mild mile milk mill mime mind mine mini mink mint mire miso miss mist mite mitt moan moat
mobs mock mode mods mold mole molt moms monk mood moon moor moos moot mope mops more morn moss most moth move mown
mows much muck muds mugs mule mull murk muse mush musk muss must mute mutt myth naan nags nail name nana naps nave
navy near neat neck need neon nerd nest nets news newt next nice nick nigh nine nits node nods none nook noon nope
norm nose nosy note noun nuke null numb nuns nuts oafs oaks oars oath oats obey obit oboe odds odes odor offs ogre
ohms oils oily oink okay okra omen omit once ones only onto onus onyx oohs oops ooze oozy opal open opts opus oral
orbs orca orcs ores oryx orzo ouch ours oust outs oval oven over owed owes owls owns oxen pace pack pact pads page
paid pail pain pair pale pall palm pals pane pang pans pant papa pare park part pass past pate path pats pave pawn
paws pays peak peal pear peas peat peck peek peel peep peer pegs pelt pens perk perm peso pest pets pews phew pick
pics pier pies pigs pike pile pill pine ping pink pins pint pipe pips pita pits pity plan play plea plod plop plot
plow ploy plug plum plus pods poem poet pogo poke pole poll polo pomp pond pony pool poop poor pope pops pore pork
port pose posh post posy pots pour pout pray prep prey prim prod prom prop pros prow pubs puck puff pugs puke pull
pulp puma pump punk puns punt puny pupa pups pure purr push puts putt quad quay quip quit quiz race rack raft rage
rags raid rail rain rake ramp rams rang rank rant raps rapt rare rash rasp rate rats rave rays raze razz read real
ream reap rear redo reds reed reef reek reel refs rein rely rent reps rest revs ribs rice rich ride rids rife riff
rift rigs rims rind ring rink riot ripe rips rise risk rite road roam roar robe robs rock rode rods role roll romp
roof rook room root rope rose rosy rote rots rout rove rows rubs ruby rude ruff rugs ruin rule rump rune rung runs
runt ruse rush rust ruts sack safe saga sage sags said sail sake sale salt same sand sane sang sank saps sari sash
sass save saws says scab scam scan scar scat scum seal seam sear seas seat secs sect seed seek seem seen seep seer
sees self sell send sent serf sets sewn sews sham shed shin ship shoe shoo shop shot show shun shut sick side sift
sigh sign silk sill silo silt sine sing sink sins sips sire sirs site sits size skew skid skim skin skip skis skit
slab slam slap slat slaw slay sled slew slid slim slip slit slob sloe slog slop slot slow slug slum slur smog smug
snag snap snip snob snot snow snub snug soak soap soar sobs sock soda sofa soft soil sold sole solo some song sons
soon soot sore sort soul soup sour sown sows spam span spar spas spat spay sped spew spin spit spot spry spud spun
spur stab stag star stat stay stem step stew stir stop stow stub stud stun subs such suds sued sues suet suit sulk
sumo sums sung sunk suns sure surf swab swag swam swan swap swat sway swig swim sync tabs tack taco tact tags tail
take talc tale talk tall tame tang tank tans tape taps taro tarp tars tart task taut taxi teak teal team tear teas
tech teed teem teen tees tell temp tend tens tent term test text than that thaw thee them then they thin this thou
thru thud thug thus tick tide tidy tied tier ties tile till tilt time tins tint tiny tips tire toad toed toes tofu
toga toil told toll tomb tome tone tons took tool toon toot tops tore torn toss tote tots tour tout town tows toys
tram trap tray tree trek trim trio trip trod trot true tsar tuba tube tubs tuck tuft tugs tuna tune turf turn tusk
tutu twig twin twos tyke type typo udon ugly undo unit unto upon urge urns used user uses vain vale vane vans vary
vase vast vats veal veer veil vein vend vent verb very vest veto vets vial vibe vice vids vies view vile vine visa
vise void vole volt vote vows wade wads wage wags waif wail wait wake walk wall wand wane want ward ware warm warn
warp wars wart wary wash wasp watt wave wavy waxy ways weak wear webs weds weed week weep weld well welt went wept
were west wets wham what whee when whew whim whip whir whiz whoa whom wick wide wife wigs wild will wilt wily wimp
wind wine wing wink wino wins wipe wire wiry wise wish wisp with wits woes woke woks wolf womb wont wood woof wool
woos word wore work worm worn wove wows wrap wren yaks yams yank yaps yard yarn yawn yeah year yell yelp yeti yews
yips yoga yoke yolk your yowl yoyo yuck yule yurt zany zaps zeal zebu zero zest zeta zinc zing zips zone zoom zoos
`,
rare: `
abas abed abri abut acai acyl adit adze aeon aero aery afro agar agee agha agio agma agon ague aids ails airt alae
alar albs alee ales alga alit alky alow alum amah ambo amie amin amis amok amyl anas anil anis ankh anoa anon anta
anti aped apse arak arbs ards aril arum arvo aryl asci ashy asps auks aver aves avos avow awes awns awol axel axil
axon ayah ayes ayin azan baba bade baht balk banc bani bant baps barm bast bate batt baud beck bels bema beni bens
berg berm bevy beys bibb bice bide bier biff bilk bine biro birr bisk bitt bize blag blat bleb blub bock bode bods
bogy bola bole boll bolo bona boor bora bork bors bort bosh bosk bott bozo brad brae braw bree brei brig brio bris
bros brut bubo bubs buhl buhr bumf buna bund bung burg burl burr burs busk buss bute buts byes byre cade cadi cads
caff calk calx camo cant capo cark caul cavy cays ceca cede cedi ceil celt cere cero cess chad cham chaw chez chia
chid chis chit choc chon chou chub chur ciao cine cion cist clew cloy coco coda cods coed coff coho coif coir coke
cole cols coly conk cony coom corf corm cosh coss cosy cote coth coxa coze craw cray cred crud crus cuke culm curs
cush cusk cuss cyan cyma cyme dace dado daff dags dahl dahs dais daks dang darg dato daub daws debs deco deil dele
deme demy dene deva dhow dido diff dink dino dins dint dirk diss dits ditz dobs doer doge doit dols dona dopa dorp
dort dory dosh doss dost dote dour dozy dray dree dreg drub drys duff duma dung duns dunt duro dyad dyer dyne ebon
echt ecru ecus eddo eery effs efts egad eger egis eide eked ekes ells emfs emir enol enow epos ergs erne erst espy
esse etas euro ewer exec exon expo eyer fado faff fain fane fard faro fash faun fave fays feal feds feer feme fens
fess fete fico fido fief fila filo fils fink fino firn fisc flam flay floc flub flue fobs foci fogy foin fops fora
forb frae frag frap frat frau fris frit froe frow frug fugs furl futz fuze fyke fyrd gads gaff gage gama gamb gamp
gamy gaol gars gath gats gaud gaur gawp gean geed gees geld gelt gena gens genu gere gers gest geum ghat ghee gibe
gild gink gins gird giro girt gite gits glam gley glia glib glim glom glop glug goad gobo gobs goer goji gore gorp
goth gran gree grig gris grog grot grum guan guck guff gula gybe gyre gyro haaf haar hade hadj haft hags haha haik
haji hajj hake haku halm hame hank hark harl hart hasp haws hebe heft heme hemp hent herl herm hern hest heth hewn
hews hick hied hies hila hims hind hins hiya hoar hobo hobs hock hods hoke hols homy hond hons hora hots hove hows
hoys huck hued hump hunk huss hwan hyla hypo iamb ibis idem ides idyl iffy ikon ilea ilex ilia imam impi info inly
inti isms ixia jags jamb jape jarl jato jefe jehu jell jibe jibs jiff jilt jink jinn jive jock jook josh joss jota
jots jube juju juke kadi kagu kaif kail kain kaki kama kame kami kana kans kaon kava kayo keas keck keef keek kelt
keno kens kepi kerb kerf kern kero keto khat kibe kief kier kina kine kino kips kish kist kith kiva knap knop koan
kobo kobs koel kohl kola kolo kook koto kudo kuna kyat lade laic lakh lama lams lank lari lase lath lati lats laud
lave lavs leal leas leer lees leet lehr leis leks lept leva leys lias lido lief lieu lilo lilt limn limy lino lira
lire lite lith loam lobo loci loco lode loge logy loll lome loos lope lorn lory lota loth loti loup lour ludo lues
luff luge lune lunk luvs lyse maas mach mack macs mads magi maim mako malm mams mana mani marl mars maun maws mays
mazy mead meed megs meld mems mene mesa meta mete mewl mics midi mien miff mils milt minx mirk miry moas moil mojo
moke mola moll mols moly mono mons mora mors mort mosh mote mots moue moxa mump mums muon mure muts muzz myna nabs
naga naif nans naos nape narc nard nark nary nays naze neap nebs nevi nibs niff nils nipa nips nisi nite nobs nock
nodi noes nogs noil noir nolo noma nome nona noob nosh nous nova nowt nubs oaky oast obis ogee ogle oiks olde oldy
oleo oles olid olio olla opah oped opes ordo orle orts oses ossa otic ouzo ovum oyer oyez pacy palp paly paps para
pard parr pars pase pash pawl pean peba peed peen pees pein peke pelf pent peon peps peri perp pert phat phis phiz
pica pice pied piet pika pili pima piny pion pirn pish piso pith pixy pleb pled pock poco poky pols poly pome pone
pong pons pood pooh poos pouf pram prig proa prof prog psis psst puce puds pula pule puli puls pung puri purl pyre
pyro qadi quag quai quid quin quod rabi racy rads raff raga ragi ragu raja raki rale rand rani rase rata rath reck
redd rede reft reis rems rend repo repp rete rets rhea rhos rial riel rile rill rime rive roan rocs roes roil rood
ropy rota roup roux rube ruck rued rues rums rusk ruth sacs sadi sago sain saki sans sard sate sati sawn scad scop
scow scud scup scut sech seel semi sene sens sera sere seta sett shad shah shaw shay shea shew shim shiv shod shul
shwa sibs sics sika sike sild sima sims sinh skat skeg skep skol skua slub slue smew smit snit soba sods soke sola
soli sols soma sone sops sora sorb sori sorn sots souk sous soya spec spiv stet stoa stob stye sudd suer sump sumy
sunn sups sura surd suss swop swot swum syne taal tabu tace tach tads tael tahr tain tais taka tala tali tamp tams
tana tanh tare tarn tass tats taus taws teds tels terf tern teth tets thar thew tics tiff tike tiki tine ting tipi
tiro tizz tody toff toft togs tola tole tolu toms tong tope topi tora tori torr tors tort tosh tost trad tret trey
trig trow trug tufa tuff tums tuns tuts twas twee twit tyre tyro tzar ulna umps unis upas updo urea uric urus utes
uvea vacs vagi vail vair vamp vang vara vars vasa vatu veep vela veld vena vide vied vier vina vino viol vita viva
vive vlog wack wadi waft wain wald wale wame wast weal wean ween weer wees weft weir weka wend wens wert whap whet
whey whin whit whop whup whys wiki wile winy wist wite wive woad wold wonk wops wort writ wynd yack yang yare yawl
yawp yaws yean yeas yeld yens yeps yest yobs yock yogi yore yous yuan yuks yuzu zeds zees zigs zine ziti zits zonk
zoon
`
};
if (typeof module !== 'undefined' && module.exports) module.exports = POOPDLE_WORDS;
