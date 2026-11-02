/*
 * Top Bins lists. Only rankings that can't change any more, or whose members are settled "as of" the date in the title.
 * type: 'player' | 'club' | 'nation'  (decides which names the suggestion box offers)
 * e: [rank or year label, name, extra accepted spellings ('|'-separated), value shown after]
 * A player name that exactly matches players.js also accepts everything that player accepts there (e.g. "Mbappe").
 */
window.FB_TOPLISTS = [
  { t: "Ballon d'Or winners of the 1990s", type: 'player', note: 'One winner a year, 1990 to 1999.', e: [
    ['1990', 'Lothar Matthäus', '', ''], ['1991', 'Jean-Pierre Papin', 'Papin|JPP', ''], ['1992', 'Marco van Basten', '', ''],
    ['1993', 'Roberto Baggio', '', ''], ['1994', 'Hristo Stoichkov', '', ''], ['1995', 'George Weah', '', ''],
    ['1996', 'Matthias Sammer', '', ''], ['1997', 'Ronaldo Nazário', '', ''], ['1998', 'Zinedine Zidane', '', ''], ['1999', 'Rivaldo', '', '']] },
  { t: "Ballon d'Or winners of the 2000s", type: 'player', note: 'One winner a year, 2000 to 2009.', e: [
    ['2000', 'Luís Figo', '', ''], ['2001', 'Michael Owen', '', ''], ['2002', 'Ronaldo Nazário', '', ''], ['2003', 'Pavel Nedvěd', '', ''],
    ['2004', 'Andriy Shevchenko', '', ''], ['2005', 'Ronaldinho', '', ''], ['2006', 'Fabio Cannavaro', '', ''], ['2007', 'Kaká', '', ''],
    ['2008', 'Cristiano Ronaldo', '', ''], ['2009', 'Lionel Messi', '', '']] },
  { t: "Most Ballon d'Or wins", type: 'player', note: 'Everyone who has won it at least twice, up to the 2025 award.', e: [
    ['1', 'Lionel Messi', '', '8 wins'], ['2', 'Cristiano Ronaldo', '', '5 wins'], ['3=', 'Johan Cruyff', '', '3 wins'],
    ['3=', 'Michel Platini', '', '3 wins'], ['3=', 'Marco van Basten', '', '3 wins'], ['6=', 'Alfredo Di Stéfano', 'Di Stefano|Alfredo Di Stefano', '2 wins'],
    ['6=', 'Franz Beckenbauer', '', '2 wins'], ['6=', 'Kevin Keegan', '', '2 wins'], ['6=', 'Karl-Heinz Rummenigge', '', '2 wins'],
    ['6=', 'Ronaldo Nazário', '', '2 wins']] },
  { t: 'World Cup best player (Golden Ball), 1982 to 2018', type: 'player', note: 'The best-player award at each men\'s World Cup.', e: [
    ['1982', 'Paolo Rossi', '', ''], ['1986', 'Diego Maradona', '', ''], ['1990', 'Salvatore Schillaci', 'Schillaci|Toto Schillaci', ''],
    ['1994', 'Romário', '', ''], ['1998', 'Ronaldo Nazário', '', ''], ['2002', 'Oliver Kahn', '', ''], ['2006', 'Zinedine Zidane', '', ''],
    ['2010', 'Diego Forlán', '', ''], ['2014', 'Lionel Messi', '', ''], ['2018', 'Luka Modrić', '', '']] },
  { t: 'World Cup top scorers (Golden Boot), 1990 to 2022', type: 'player', note: 'The award was shared in 1994.', e: [
    ['1990', 'Salvatore Schillaci', 'Schillaci|Toto Schillaci', '6 goals'], ['1994', 'Hristo Stoichkov', '', '6 goals'],
    ['1994', 'Oleg Salenko', 'Salenko', '6 goals'], ['1998', 'Davor Šuker', '', '6 goals'], ['2002', 'Ronaldo Nazário', '', '8 goals'],
    ['2006', 'Miroslav Klose', '', '5 goals'], ['2010', 'Thomas Müller', '', '5 goals'], ['2014', 'James Rodríguez', '', '6 goals'],
    ['2018', 'Harry Kane', '', '6 goals'], ['2022', 'Kylian Mbappé', '', '8 goals']] },
  { t: 'Countries that have won the Euros', type: 'nation', note: 'Every men\'s European Championship winner, 1960 to 2024, most titles first.', e: [
    ['1', 'Spain', '', '4 titles'], ['2', 'Germany', 'West Germany', '3 titles'], ['3=', 'Italy', '', '2 titles'], ['3=', 'France', '', '2 titles'],
    ['5=', 'Soviet Union', 'USSR', '1960'], ['5=', 'Czechoslovakia', '', '1976'], ['5=', 'Netherlands', 'Holland', '1988'],
    ['5=', 'Denmark', '', '1992'], ['5=', 'Greece', '', '2004'], ['5=', 'Portugal', '', '2016']] },
  { t: 'The first ten clubs to win the European Cup', type: 'club', note: 'In the order they first won it.', e: [
    ['1956', 'Real Madrid', '', ''], ['1961', 'Benfica', '', ''], ['1963', 'AC Milan', 'Milan', ''], ['1964', 'Inter', 'Inter Milan|Internazionale', ''],
    ['1967', 'Celtic', '', ''], ['1968', 'Manchester United', 'Man United|Man Utd', ''], ['1970', 'Feyenoord', '', ''],
    ['1971', 'Ajax', '', ''], ['1974', 'Bayern Munich', 'Bayern', ''], ['1977', 'Liverpool', '', '']] },
  { t: 'Premier League all-time top scorers', type: 'player', note: 'As at the end of the 2024-25 season.', e: [
    ['1', 'Alan Shearer', '', '260'], ['2', 'Harry Kane', '', '213'], ['3', 'Wayne Rooney', '', '208'], ['4', 'Andy Cole', '', '187'],
    ['5', 'Mohamed Salah', '', '186 (still playing)'], ['6', 'Sergio Agüero', '', '184'], ['7', 'Frank Lampard', '', '177'],
    ['8', 'Thierry Henry', '', '175'], ['9', 'Robbie Fowler', '', '163'], ['10', 'Jermain Defoe', '', '162']] },
  { t: "England men's all-time top scorers", type: 'player', note: 'The top nine (three are tied in seventh), as of 2025.', e: [
    ['1', 'Harry Kane', '', 'still playing'], ['2', 'Wayne Rooney', '', '53'], ['3', 'Bobby Charlton', '', '49'], ['4', 'Gary Lineker', '', '48'],
    ['5', 'Jimmy Greaves', '', '44'], ['6', 'Michael Owen', '', '40'], ['7=', 'Tom Finney', 'Finney|Sir Tom Finney', '30'],
    ['7=', 'Nat Lofthouse', 'Lofthouse', '30'], ['7=', 'Alan Shearer', '', '30']] },
  { t: 'Copa América winners', type: 'nation', note: 'Every country to win South America\'s championship, up to 2024, most titles first.', e: [
    ['1', 'Argentina', '', '16 titles'], ['2', 'Uruguay', '', '15 titles'], ['3', 'Brazil', '', '9 titles'], ['4=', 'Paraguay', '', '2 titles'],
    ['4=', 'Chile', '', '2 titles'], ['4=', 'Peru', '', '2 titles'], ['7=', 'Colombia', '', '1 title'], ['7=', 'Bolivia', '', '1 title']] },
  { t: 'Clubs that have won the Premier League', type: 'club', note: 'Every champion from 1992-93 to 2024-25, most titles first.', e: [
    ['1', 'Manchester United', 'Man United|Man Utd', '13 titles'], ['2', 'Manchester City', 'Man City', '8 titles'], ['3', 'Chelsea', '', '5 titles'],
    ['4', 'Arsenal', '', '3 titles'], ['5', 'Liverpool', '', '2 titles'], ['6=', 'Blackburn Rovers', 'Blackburn', '1 title'],
    ['6=', 'Leicester City', 'Leicester', '1 title']] },
  { t: "Spain's most-capped men", type: 'player', note: 'All have finished playing for Spain (as of 2025).', e: [
    ['1', 'Sergio Ramos', '', '180'], ['2', 'Iker Casillas', '', '167'], ['3', 'Sergio Busquets', '', '143'], ['4', 'Xavi', '', '133'],
    ['5', 'Andrés Iniesta', '', '131'], ['6', 'Andoni Zubizarreta', 'Zubizarreta', '126'], ['7', 'David Silva', '', '125'],
    ['8', 'Xabi Alonso', '', '114'], ['9=', 'Cesc Fàbregas', '', '110'], ['9=', 'Fernando Torres', '', '110']] },
  { t: "Italy's most-capped men", type: 'player', note: 'All have finished playing for Italy (as of 2025).', e: [
    ['1', 'Gianluigi Buffon', '', '176'], ['2', 'Fabio Cannavaro', '', '136'], ['3', 'Paolo Maldini', '', '126'], ['4', 'Leonardo Bonucci', '', '121'],
    ['5=', 'Daniele De Rossi', '', '117'], ['5=', 'Giorgio Chiellini', '', '117'], ['7', 'Andrea Pirlo', '', '116'], ['8', 'Dino Zoff', '', '112'],
    ['9', 'Gianluca Zambrotta', '', '98'], ['10', 'Giacinto Facchetti', 'Facchetti', '94']] },
  { t: 'Every club Zlatan Ibrahimović played for', type: 'club', note: 'His senior clubs, in order (he had two spells at Milan).', e: [
    ['1', 'Malmö FF', 'Malmo|Malmö|Malmo FF', '1999'], ['2', 'Ajax', '', '2001'], ['3', 'Juventus', 'Juve', '2004'], ['4', 'Inter', 'Inter Milan|Internazionale', '2006'],
    ['5', 'Barcelona', 'Barca|Barça', '2009'], ['6', 'AC Milan', 'Milan', '2010'], ['7', 'Paris Saint-Germain', 'PSG|Paris SG|Paris', '2012'],
    ['8', 'Manchester United', 'Man United|Man Utd', '2016'], ['9', 'LA Galaxy', 'Galaxy|Los Angeles Galaxy', '2018']] }
];
