// SPDX-License-Identifier: AGPL-3.0-or-later
// Words a program may use where a data name goes without declaring them. A reference the parser
// cannot resolve is checked against these before it is taken for a name nothing declares.
//
// GENERATED - do not edit by hand. Run `node diag/generate-words.mjs` to rebuild it from
// provenance/words.json, which records, for every word below, the document that attests it.
//
// Every word here comes from a standard or from a compiler vendor's reference for its own compiler.
// No other implementation's source code was consulted. That matters: it is what lets this file be
// licensed on the project's own terms rather than on another project's. See LICENSING.md.
//
// Attested by, retrieved 2026-09-24:
//   ACUCOBOL-GT Appendices v9.0.1, Appendix B "ACUCOBOL-GT Reserved Words" and Appendix F "Intrinsic Functions"; ACUCOBOL-GT Reference Manual v8.1.3; Appendices, ACUCOBOL-GT v8.1.3; RM/COBOL Language Reference Manual, Second Edition (Version 12, Liant Software), Appendix A "Reserved Words"; RM/COBOL Language Reference Manual Version 8.0 - ACUCOBOL-GT Appendices v9.0.1, Appendix B.2 Reserved Word List (primary source for ACUCOBOL words); ACUCOBOL-GT Appendices v9.0.1, Appendix B.1 Conventions (the dialect-marker legend); ACUCOBOL-GT Appendices v9.0.1, Appendix F.2.1 Function Definitions (intrinsic function table); ACUCOBOL-GT Appendices v9.0.1 WebWorks page manifest; its section titles "F.n <NAME> Function" independently name every intrinsic function; ACUCOBOL-GT User's Guide v9.0.1 section 2.2.9 Reserved Word Options (-R2/-R8/-Ra/-Ri/-Rr/-Rs/-Rv: the compiler switches that correspond to the appendix markers); Appendices, ACUCOBOL-GT v8.1.3 (Micro Focus) - Appendix B Reserved Words and Appendix F Intrinsic Functions; second, independent extraction of the same two lists; Reference Manual, ACUCOBOL-GT v8.1.3 (Micro Focus) - special registers, SPECIAL-NAMES system-names, ACCEPT FROM DATE YYYYMMDD syntax; RM/COBOL Language Reference Manual, Second Edition (Version 12, Liant Software, copyright 1985-2008, as served by supportline.microfocus.com) - Appendix A Reserved Words, Table 37 Context-Sensitive Words, Tables 38-42 Nonreserved System-Names, and Chapter 1 Special Registers; RM/COBOL Language Reference Manual Version 8.0 (Liant Software) - Appendix A Reserved Words; cross-check of the v12 list
//   CICS Transaction Server for z/OS Version 5 Release 3, Application Programming Reference (SC34-7402-00), Appendix H 'BMS-related constants' - Appendix H, BMS-related constants: Table 24 (DFHBMSCA) and Table 1 (DFHAID)
//   Fujitsu BS2000 COBOL2000 V1.6 COBOL Compiler Reference Manual; Fujitsu BS2000 COBOL85 V2.3A Reference Manual (U3979-J-Z125-6-7600); FUJITSU Software NetCOBOL V11.0 Language Reference (B1WD-3304-02ENZ0(00), October 2014); Bull DPS7000/XTA NOVASCALE 7000 GCOS 7 COBOL85 Reference Manual (47 A2 05UL 04, November 1997) - COBOL2000 V1.6 Reference Manual, "COBOL words": reserved words, compiler-directive words, context-sensitive words, special registers (English); COBOL2000 V1.6 Sprachbeschreibung, "COBOL-Woerter" (German edition; fetched only to confirm the reserved words are the English COBOL words); COBOL2000 V1.6 Reference Manual, "Overview of intrinsic functions" (English); COBOL2000 V1.6 COBOL Compiler Reference Manual, full PDF (English): corroborates the HTML parse; implementor-name Table 8; ASSIGN device names; BS2000 COBOL85 V2.3A Reference Manual, U3979-J-Z125-6-7600 (English): reserved words table, special registers Table 2-5, implementor-names Table 3-1; FUJITSU Software NetCOBOL V11.0 Language Reference, B1WD-3304-02ENZ0(00), October 2014 (English): Appendix A List of Reserved Words, intrinsic functions, special registers, SPECIAL-NAMES function-names; Bull DPS7000/XTA NOVASCALE 7000 GCOS 7 COBOL85 Reference Manual, 47 A2 05UL 04, November 1997 (English): Appendix A COBOL Reserved Words, special registers
//   User Interface Programming, ACUCOBOL-GT Version 8.1.3 (Micro Focus, E-01-UI-100501-ACUCOBOL-GT-8.1.3); Reference Manual, ACUCOBOL-GT Version 8.1.3 (Micro Focus); Appendices, ACUCOBOL-GT Version 8.1.3 (Micro Focus); ACUCOBOL-GT User's Guide Version 9.0.1 section 2.2.9 and Appendices Version 9.0.1 Appendix B.2; RM/COBOL Language Reference Manual, Second Edition (Version 12, Liant Software), Appendix A Table 37; RM/COBOL Language Reference Manual Version 8.0 (Liant Software), Appendix A Table A-1 - User Interface Programming, ACUCOBOL-GT 8.1.3 (form E-01-UI-100501-ACUCOBOL-GT-8.1.3). Primary source for this pass: 3.2 Control Types, Handles, and IDs; 4.4 Styles and Special Properties; Chapter 5 Control Types Reference, whose per-control 5.n.1 Common Properties / STYLES and 5.n.2 Special Properties lists define every style and special property; 5.2 Global Styles; Chapter 6 Events Reference; and the manual index, which repeats each property as '<WORD>, <CONTROL-TYPE> style|special property <page>'; Reference Manual, ACUCOBOL-GT 8.1.3. Used for 5.8 Screen Section general format (5-92..5-94), 6.4.9 Common Screen Options (EVENT-LIST / AX-EVENT-LIST / EXCLUDE-EVENT-LIST at 6-34, MAX-HEIGHT / MAX-WIDTH / MIN-HEIGHT / MIN-WIDTH at 6-43), 6.6 DISPLAY Formats 11 and 12 (window phrases MIN-SIZE, MAX-SIZE, MIN-LINES, MAX-LINES, NO-CLOSE at 6-186..6-196), and the ACCEPT ... FROM STANDARD OBJECT 'Object-Name / Resource' table at 6-92..6-93; Appendices, ACUCOBOL-GT 8.1.3. Appendix B Reserved Words (the list these words are missing from, and the source of the alphabet-heading letters), Appendix H Configuration Variables and Appendix I Library Routines (where STDIN, TIMESTAMP, WINAPI, XOR, STDOUT, STDERR turn out to live); ACUCOBOL-GT User's Guide 9.0.1, 2.2.9 Reserved Word Options. The -Rw entry is the vendor's own statement that control names and property names are NOT reserved words: 'This option also allows you to suppress some non-reserved words, such as control names (e.g., "entry-field", "label") or property names (e.g., "max-text", "bitmap-number").'; ACUCOBOL-GT Appendices 9.0.1, Appendix B.2 Reserved Word List. Re-parsed here only as a negative control: 629 tokens harvested, and not one of the 86 words attested below appears in it; RM/COBOL Language Reference Manual, Second Edition (Version 12, Liant Software, copyright 1985-2008, as served by supportline.microfocus.com), Appendix A, Table 37 'Context-Sensitive Words' - the table that attests BACKGROUND, CASE-INSENSITIVE, END-COPY, END-REPLACE, FOREGROUND, TRIMMED, WHILE; RM/COBOL Language Reference Manual Version 8.0 (Liant Software). Appendix A, Table A-1 'Context-Sensitive Words', which carries BACKGROUND, CASE-INSENSITIVE, FOREGROUND and TRIMMED but not END-COPY, END-REPLACE or WHILE
//   Adjudication of the 21 residue words against the first pass's 230-file corpus plus newly searched vendor documentation. Documents relied on: ACUCOBOL-GT 8.1.3 User Interface Programming, 8.1.3 Reference Manual, 8.1.3 Appendices and 9.0.1 Appendices Appendix B.2 Reserved Word List; Heirloom Computing Elastic COBOL Language Reference Manual Appendix (August 2012); Micro Focus Visual COBOL 9.0 Reserved Words Table and Context-sensitive Words Table; IBM Enterprise COBOL for z/OS 6.4 'Reserved words'; IBM COBOL for VSE/ESA Language Reference SC26-8073-02 Table 48; Veryant isCOBOL Evolve 2021R2 Appendix D 'Intrinsic Functions' and isCOBOL Evolve 2023 R1 Overview; RM/COBOL Language Reference Manual, Second Edition (Version 12, Liant Software); Unisys COBOL ANSI-85 Programming Reference Manual Vol.1 (86001518-307); ISO/IEC 1989:20xx CD 1.2 (2009-08-23); COBOL Consortium (Japan) summary of ISO/IEC 1989:2023 - ACUCOBOL-GT 8.1.3 User Interface Programming, ch.5 FRAME 'special properties': the LOW-COLOR property definition entry at 5-70 and the index entry 'LOW-COLOR, FRAME special property 5-70'; Heirloom Computing, Elastic COBOL Language Reference Manual Appendix (rev. August 2012): FRAME 'Properties Table' p.69 with columns Name/MODIFY/INQUIRE/Descriptions, the BAR 'Properties Table', and the copybook constants list (FP-*, BRS-*); Micro Focus Visual COBOL 9.0, Context-sensitive Words Table: the full GUI property-word set including every BITMAP-prefixed word, TRANSPARENT-COLOR, DOT-DASH and NO-TAB; Micro Focus Visual COBOL 9.0, Reserved Words Table: METACLASS, UNEQUAL, and the BINARY-CHAR/-SHORT/-LONG/-DOUBLE usage set; IBM Enterprise COBOL for z/OS 6.4, appendix 'Reserved words': EGCS, and the BINARY-CHAR/-SHORT/-LONG/-DOUBLE usage set; IBM COBOL for VSE/ESA Language Reference, SC26-8073-02, Table 48 'Reserved Words' p.454: the sequence AREA, AREA-VALUE, AREAS; ACUCOBOL-GT 9.0.1 Appendices, Appendix B.2 Reserved Word List: 624 distinct words, containing no GUI property names at all; ACUCOBOL-GT 8.1.3 Reference Manual, Procedure Division relation-condition general format '{ IS UNEQUAL TO obj-item }' at 6-222; Veryant isCOBOL Evolve 2021R2, Appendix D 'Intrinsic Functions': the complete table of all 66 intrinsic functions isCOBOL provides; Veryant isCOBOL Evolve 2023 R1 Overview: the only literal 'Content-Length' in the entire corpus, an HTTP response header inside a logged SOAP trace; RM/COBOL Language Reference Manual, Second Edition (Version 12, Liant Software, copyright 1985-2008, as served by supportline.microfocus.com): ACCEPT/FULL prose using the phrase 'field terminator'; ACUCOBOL-GT 8.1.3 Appendices: the line-drawing figure enumeration whose item 10 reads 'missing right line'; Unisys COBOL ANSI-85 Programming Reference Manual Vol.1 (86001518-307): VREADTIMER prose 'the ACCEPT statement with the TIMER option for the microsecond timer'; COBOL Consortium (Japan), overview of the new features of the 2023 edition of the COBOL international standard; the only new word-like items it names are SHIFT-L, SHIFT-LC, SHIFT-R, SHIFT-RC; ISO/IEC 1989:20xx CD 1.2 dated 2009-08-23, full 910-page text (zip member STD.BK.pdf), searched for every candidate intrinsic-function name in this scope
//   Bull DPS7000/XTA GCOS 7 COBOL 85 Reference Manual (47 A2 05UL Rev04, November 1997); FUJITSU Software NetCOBOL V11.0 Language Reference (B1WD-3304-02ENZ0(00), October 2014); Fujitsu BS2000 COBOL85 V2.3A Reference Manual (U3979-J-Z125-6-7600) and BS2000 COBOL2000 V1.6 COBOL Compiler Reference Manual; IBM Enterprise COBOL for z/OS V6.4 Language Reference (SC27-8713-03) with its IBM Docs 'SPECIAL-NAMES paragraph' and 'Reserved words' topics; HP COBOL II/XL Reference Manual (HP 3000 / MPE iX, doc id B3150090013); Heirloom Computing Elastic COBOL Language Reference Manual; Unisys COBOL ANSI-85 Programming Reference Manual Volume 1 (8600 1518-307, February 2003); HP COBOL Manual for TNS and TNS/R Programs (522555-006); ACUCOBOL-GT Reference Manual and Appendices v8.1.3; Micro Focus Visual COBOL 6.0 COBOL Language Reference, 'Switch-Names'; COBOL Consortium of Japan, '2023 nen-ban COBOL kokusai kikaku no shin-kinou no gaiyou'; INCITS, 'Available Now - 2023 Edition of ISO/IEC 1989, COBOL' - Bull DPS7000/XTA GCOS 7 COBOL 85 Reference Manual, 47 A2 05UL Rev04 (Nov 1997): Appendix A 'COBOL Reserved Words' (pp. A-1..A-16 = PDF pp. 611-626), chapter 3 'System-Names', Appendix C 'The ANSI Flagger'; FUJITSU Software NetCOBOL V11.0 Language Reference, B1WD-3304-02ENZ0(00) (Oct 2014): 6.2 'Procedure Division Header' Format (p.238), 6.4.6 CALL statement Formats 1 and 2 (pp.277-279), Appendix A 'List of Reserved Words' (pp.684-704), SPECIAL-NAMES function-name-2 SWITCH-n rule (p.92); Fujitsu BS2000 COBOL85 V2.3A Reference Manual, U3979-J-Z125-6-7600: glossary entry 'Implementor-name' (p.21), Table 3-1 'Implementor-names and their meanings' (p.126), reserved-words list row 'USW-1...USW-31' (p.58); Fujitsu BS2000 COBOL2000 V1.6 COBOL Compiler Reference Manual: glossary entry 'Implementor-name', Table 8 'Implementor-names and their meanings' (6.2.3.1, pp.199-200); IBM Enterprise COBOL for z/OS V6.4 Language Reference, SC27-8713-03: OCCURS clause 'Format 2: variable-length tables' and the UNBOUNDED syntax-element description (p.203); ALLOCATE statement Format and 'LOC phrase' (pp.313-315); XML GENERATE statement Format, 'XML-DECLARATION phrase' and 'NAMESPACE and NAMESPACE-PREFIX phrases' (p.483ff); XML PARSE statement Format and 'VALIDATING phrase'; IBM Enterprise COBOL for z/OS 6.4, 'SPECIAL-NAMES paragraph': the environment-name-2 entry that states the UPSI range; IBM Enterprise COBOL for z/OS 6.4, appendix 'Reserved words' (one table; columns Word / Reserved / Standard only / Potential reserved words; 515 word rows) - the negative check for the IBM candidates; COBOL Consortium of Japan (COBOL ), '2023 COBOL ' by Wataru Takagi (Hitachi), 2024-10-08, updated 2025-05-16: item (3) names the four boolean shift operators added by ISO/IEC 1989:2023; INCITS, 'Available Now - 2023 Edition of ISO/IEC 1989, COBOL': reproduces the ISO/IEC 1989:2023 foreword 'main changes' list, which includes '- Boolean shifting operators' (corroborates the feature; does not name the words); Reference Manual, ACUCOBOL-GT v8.1.3: SPECIAL-NAMES paragraph, Syntax Rule 1 - the ACUCOBOL switch-name range (pp.4-6/4-7); Appendices, ACUCOBOL-GT v8.1.3: Appendix D 'List of Errors', messages 'Invalid switch number', 'Missing switch number' and 'Unknown switch' - each restates the SWITCH-1..SWITCH-26 range; Heirloom Computing, Elastic COBOL Language Reference Manual: SWITCH clause general rule 4, 'Certain aliases exist for the switches for compatibility with more platforms', and its Name/Synonyms table (PDF pp.144-145), which names UPSI-0 through UPSI-9; Unisys COBOL ANSI-85 Programming Reference Manual Volume 1, 8600 1518-307 (Feb 2003): SPECIAL-NAMES switch-name clause - the Unisys SW1..SW8 range; HP COBOL Manual for TNS and TNS/R Programs, 522555-006: 'System-Name Clause With a STATUS Phrase' - the HP NonStop SWITCH-1..SWITCH-15 range; HP COBOL II/XL Reference Manual (HP 3000, MPE/iX 5.0 documentation, doc id B3150090013; 3kranger.com HTTrack mirror of docs.hp.com), 'SPECIAL-NAMES Paragraph': Table 6-1 'HP COBOL II Feature, Switch, and Device Names' with the Switch Name row 'SW0 through SW15', and the 'Software Switches' subsection; HP COBOL II/XL Reference Manual, Appendix F 'COBOL Reserved Word List', Table F-1 - negative check: the SWn switch-names are not in it; Micro Focus Visual COBOL 6.0 COBOL Language Reference, 'Switch-Names' (Environment Division) - the Micro Focus switch numbering
//   ISO/IEC 1989, Information technology - Programming languages, their environments and system software interfaces - Programming language COBOL. Re-derived from the three full draft texts reachable without a paywall: (1) ISO/IEC FCD 1989:2001 (E), Final Committee Draft, working document ISO/IEC/JTC 1/SC 22/WG 4 N 0147, 2001-01-15, 891 pp, circulated by the SC 22 secretariat as SC 22 N 3204 - the draft of the edition published as ISO/IEC 1989:2002; (2) ISO/IEC 1989:20xx CD 1.2 (E), Committee Draft International Standard, 2009-08-23, 910 pp, distributed as std.zip by INCITS PL22.4 (formerly J4); and (3) ISO/IEC 1989:20xx FCD 1.0 (E), Final Committee Draft International Standard, 2010-07-13, 901 pp, circulated as SC 22 N 4561 'Text for FCD ballot or comment' - the latest full text on the track to ISO/IEC 1989:2014, fetched by this pass. Clause numbering of the published editions was confirmed against the official Contents-only previews of ISO/IEC FDIS 1989:2013, ISO/IEC 1989:2014 and ISO/IEC 1989:2023. - ISO/IEC FCD 1989:2001 (E) (WG4 N 0147), 891 pp: 8.9 Reserved words p.140, 8.10 Context-sensitive words p.143, 8.12 Compiler-directive reserved words p.146, 8.2 Locales p.59 and 8.2.1 Locale field names p.60, 14.7.11.2.5 Exception-names and exception conditions with Table 13 pp.401-405; ISO/IEC 1989:20xx CD 1.2 (E), 2009-08-23, 910 pp: 8.9 Reserved words p.154, 8.10 Context-sensitive words p.157, 8.12 Compiler-directive words p.161, 7.3.20 TURN directive p.58, 8.2 Locales p.65 and 8.2.1 Locale field names p.66, 14.6.12.1.5 Exception-names and exception conditions with Table 14 pp.422-427, 14.6.12.2 Incompatible data p.427; NEW THIS PASS. SC 22 N 4561, 'Text for FCD ballot or comment', dated 2010-08-06, carrying the full ISO/IEC 1989:20xx FCD 1.0 (E) of 2010-07-13, 901 pp - the latest full draft text of the 2014 edition that is publicly reachable: 8.9 Reserved words p.156, 8.10 Context-sensitive words p.159, 8.12 Compiler-directive words p.163, 14.6.12.1.5 Exception-names and exception conditions with Table 14 p.426; ISO/IEC 1989:2014 official preview, cover plus Contents to p.xv: 8.9 Reserved words p.167, 8.10 Context-sensitive words p.170, 8.12 Compiler-directive words p.174, 11.9.7 FLOAT-BINARY clause and 11.9.8 FLOAT-DECIMAL clause p.220. No word lists; ISO/IEC FDIS 1989:2013 (E) official preview, voting 2013-09-18 to 2013-11-18, served under the 2014 catalogue entry 51416; URL re-verified by sha256 this pass. Contents only, carrying 11.9.7 FLOAT-BINARY clause and 11.9.8 FLOAT-DECIMAL clause. No word lists; ISO/IEC 1989:2023 official preview, cover plus Contents to p.xv: 8.5.2.9 Message-tag category p.164, 8.9 Reserved words p.205, 8.10 Context-sensitive words p.209, 11.9.8 FLOAT-BINARY clause and 11.9.9 FLOAT-DECIMAL clause p.275. No word lists; INCITS PL22.4 (J4) 08-0116 (S-16), 'Candidate features for a future revision'. Cited only for the negative finding on EXCLUSIVE-OR; Archived INCITS PL22.4 (J4) document index, 2016 snapshot. Cited only for the negative findings on FLOAT-DECIMAL-7 and ENGRAVED. The first pass did not record the exact Wayback timestamp and web.archive.org answered 'Temporarily Offline' during this pass, so the URL is given in the date-prefix form; RM/COBOL Language Reference Manual, Second Edition (Version 12, Liant Software, copyright 1985-2008, as served by supportline.microfocus.com). Cited only for the negative finding on CURRENCY-SYMBOL, which occurs there solely inside the RUN-ATTR configuration keyword EDIT-CURRENCY-SYMBOL
//   Micro Focus Visual COBOL 9.0 COBOL Language Reference, appendix "Context-sensitive Words Table" (topic id HRLHLHARES04), with the same manual's "Reserved Words Table" (HRLHLHARES01U005) and "Special registers" (HRLHLHCLANU020); Micro Focus Net Express 3.1 Language Reference (Appendix D "Reserved Words", lrares.htm, and Chapter 2 "COBOL Language", lrclan.htm); and Micro Focus Server Express 6.0 Language Reference, "reuze" doc set (lhclan.htm). Micro Focus publishes these HTML topic sets without form numbers; the topic ids above are the documents' own DC.Identifier values. - Appendix: Context-sensitive Words Table (DC.Identifier HRLHLHARES04) - the table that attests all 181 words; Appendix: Reserved Words Table, with the dialect-code legend - checked as negative evidence: none of the 13 hunted registers, and none of the 181, is a row of it; Special registers, Table 1 (Visual COBOL 9.0) - read in full; ADDRESS OF, CURRENT-DATE, DEBUG-ITEM, JSON-CODE, JSON-STATUS, LENGTH OF, LINAGE-COUNTER, RETURN-CODE, SHIFT-IN, SHIFT-OUT, SORT-*, TALLY, TIME-OF-DAY, WHEN-COMPILED, XML-* only; Net Express 3.1 Language Reference, Appendix D: Reserved Words - the file cited for 7 words; the string is an unrendered HTML comment at the head of D.3 and is NOT used as attestation; Net Express 3.1 Language Reference, Chapter 2 COBOL Language - 2.2.4.6 Special Registers (12-row table) and 2.2.4.7 Predefined Object Identifiers; fetched by this pass as negative evidence for the 13; Server Express 6.0 ('reuze') Language Reference, COBOL Language chapter - Table 2: Special Registers (22 rows); fetched live by this pass as negative evidence for the 13
//   GnuCOBOL Programmer’s Guide, for GnuCOBOL 3.2 (15 January 2023 build), Gary L. Cutler and Vincent B. Coen - 8.1.11 CONCAT and CONCATENATE, 8.1.58 MODULE-CALLER-ID, 8.1.61 MODULE-ID, 8.1.63 MODULE-SOURCE (Intrinsic Functions); 7.7 Special Registers (NUMBER-OF-CALL-PARAMETERS); 7.8.1.5 ACCEPT FROM DATE/TIME (MICROSECOND-TIME); 7.7 Special Registers and Appendix C1 Internal registers (COB-CRT-STATUS); 8.1.59, 8.1.60, 8.1.62, 8.1.64 and Appendix C2 Intrinsic Functions (MODULE-DATE, MODULE-FORMATTED-DATE, MODULE-PATH, MODULE-TIME); 8.1.88, 8.1.89 and Appendix C2 (SUBSTITUTE, SUBSTITUTE-CASE); 5.1.3 SPECIAL-NAMES rule 14 and Appendix C4 System names: device (STDIN, STDOUT, STDERR); Appendix C1 Common reserved words (B-SHIFT-L, B-SHIFT-R, B-SHIFT-LC, B-SHIFT-RC, NOTHING, NONNUMERIC, NESTED, FLOAT-INFINITY, PHYSICAL, ACTIVATING, TOP-LEVEL, CURRENT, STACK, ANUM, HEX, NAT, FLOAT-NOT-A-NUMBER, PASCAL, STDCALL); An earlier build of the same guide, which attests five of the seven; CONCAT and MICROSECOND-TIME postdate it
//   IBM Enterprise COBOL for z/OS, V6.4 Language Reference (SC27-8713-03, seventh edition, 28 April 2026 update) - Special registers; Intrinsic functions; Function definitions (Table of functions); SPECIAL-NAMES paragraph (Meanings of environment names); WRITE for sequential files (channel environment-names); DEBUG-ITEM special register; Enterprise COBOL for z/OS 6.4 Language Reference, complete PDF (SC27-8713-03); Text rendering of the PDF, used for cross-checking only
//   IBM Enterprise COBOL for z/OS, Version 6.4, Language Reference -- appendix "Reserved words" (form number SC27-8713-03, not attested in the fetched bytes) - Reserved words
//   IBM COBOL for AIX 5.1 Language Reference (SC27-5403-00) and its IBM Docs "Reserved words" appendix; IBM COBOL for Linux on x86 1.1/1.2 Language reference (SC28-3117-01) and its "Reserved words" appendix; IBM COBOL for VSE/ESA Language Reference Release 1 (SC26-8073-02) Appendix D; Enterprise COBOL for z/OS Compiler and Runtime Migration Guide V3R4 (GC27-1409-04) Appendix B and Enterprise COBOL for z/OS 6.4 Migration Guide (GC27-8715-03) Appendix B, whose reserved-word comparison tables attest IBM COBOL, VS COBOL II and OS/VS COBOL; IBM VS COBOL for OS/VS Release 2.4 (GC26-3857-3) - IBM COBOL for AIX 5.1 - Appendix "Reserved words" (Table 1), raw HTML table, 512 word rows; IBM COBOL for Linux on x86 1.1 - Appendix "Reserved words" (Table 1), 515 word rows; IBM COBOL for Linux on x86 1.2 - Appendix "Reserved words" (Table 1), 515 word rows; COBOL for AIX Language Reference V5.1, SC27-5403-00 - "Special registers" (p.16-48), "Function-names"/Table 58 table of functions and Chapter 22 function sections, Table 6 "Meanings of environment names" (p.114), Appendix F "Reserved words" (Table 66); IBM COBOL for Linux on x86 1.2 Language reference, SC28-3117-01 - "Special registers", Part 7 intrinsic-function chapters, Table 5 "Meanings of environment names" (p.98), "Reserved words" appendix; Enterprise COBOL for z/OS Compiler and Runtime Migration Guide V3R4, GC27-1409-04 - Appendix B "COBOL reserved word comparison", Table 46 (PDF pages 266-283 = book pages 245-262): one row per word, columns Enterprise COBOL / IBM COBOL / VS COBOL II / OS/VS COBOL; Enterprise COBOL for z/OS 6.4 Migration Guide, GC27-8715-03 - Appendix B "COBOL reserved word comparison", Table 55 (PDF pages 328-350), same four columns; used as the second edition of the same table and to adjudicate two disagreements with GC27-1409-04; IBM COBOL for VSE/ESA Language Reference Release 1, SC26-8073-02 - Appendix D "Reserved Words", Table 48 (7 pages, two column-groups per page: COBOL/VSE | Standard Only | RFD); also "Special Registers" (p.8ff) and Table 4 "Meanings of Environment Names"; IBM VS COBOL for OS/VS Release 2.4, GC26-3857-3 (the OS/VS COBOL language manual; scanned IBM publication with an OCR text layer, mirrored by bitsavers) - "Reserved words" (book p.15, the six types incl. special registers), APPLY CORE-INDEX format (book p.369), special register LABEL-RETURN (book p.375), FIPS-flagging lists of special registers (book p.343/348), Appendix F "OS/VS COBOL Reserved Word List". Used for adjudication and for two words only, never as a bulk source, because OCR corrupts digits (SKIP1 -> "SKIPI", C01 -> "COl", UPSI-0 -> "UPSI-O")
//   IBM interface-block field definitions: CICS TS 6.x 'EIB fields including EIBRESP and EIBRESP2' and Data Areas 'EIB - EXEC interface block' (DFHEIBLK); IMS 15.4 Application Programming 'Specifying the DL/I interface block (DIB)'; Db2 13 for z/OS SQL Reference 'The included SQLCA', 'Description of SQLCA fields', 'The included SQLDA' and 'SQLDA field descriptions' - CICS TS 6.x: EIB fields including EIBRESP and EIBRESP2 (29 EIB fields, COBOL PICTURE per field); CICS TS Data Areas: EIB - EXEC interface block (DFHEIBLK layout, offsets, reserved fields); CICS TS 5.3: EIB fields (cross-check of the same 29 names and pictures); CICS TX 10.1: EXEC interface block (EIB) fields (adds EIBLABEL, COBOL-only); TXSeries for Multiplatforms 11.1: EXEC interface block (EIB) fields (second attestation of EIBLABEL); IBM APAR PI88564 (CICS standalone translator for COBOL): DFHEIGDI, EIBCPOSN, EIBCALEN generated COMP/COMP-5; CICS TS 5.6: COBOL translation output (copybooks DFHEIBLK and DFHEIBLC); IMS 15.4 Application Programming: Specifying the DL/I interface block (DIB) - COBOL variable names and PICTUREs; IMS 13 Application Programming: Specifying the DIB (older edition - shows the fillers absent from the COBOL list); Db2 13 for z/OS SQL Reference: The included SQLCA (COBOL declaration generated by INCLUDE SQLCA); Db2 13 for z/OS SQL Reference: Description of SQLCA fields (per-field data types; SQLCADE note); Db2 13 for z/OS SQL Reference: The included SQLDA (COBOL declaration generated by INCLUDE SQLDA); Db2 13 for z/OS SQL Reference: SQLDA field descriptions
//   Intrinsic functions of COBOL across editions and vendors, re-derived from: IBM Enterprise COBOL for z/OS 6.4 Language Reference (SC27-8713) and 6.2/6.3/6.4 What's New; Micro Focus COBOL Language Reference (Visual COBOL 3.0 PU12 and reuze 60d); ACUCOBOL-GT 10.0.1 Reference Manual Appendix F; FUJITSU Software NetCOBOL V11.0 User's Guide B1WD-3306-01ENZ0 Appendix D; Veryant isCOBOL Evolve 2021R2 Appendix D; NIST SP 500-203 (ANSI X3.23A-1989 intrinsic function addendum); INCITS announcement of ISO/IEC 1989:2023 with the third edition's change list; ISO/IEC 1989:2014 and :2023 free previews - Enterprise COBOL for z/OS 6.4 Language Reference, Part 7 'Intrinsic functions' (one child topic per function, each named and defined); '2002/2014 COBOL Standard features implemented in Enterprise COBOL V3 or later' - rows 'New intrinsic functions' and 'Support for industry standard date and time formats'; 'IBM extensions and COBOL standards' - list of functions that are extensions to the 85 COBOL Standard; Enterprise COBOL 6.2 What's New - 'added as part of the 2014 COBOL Standard' list and 'added as IBM extensions' list; Enterprise COBOL 6.3 What's New - 'Support for 2002 COBOL Standard' vs 'Support for 2014 COBOL Standard' date/time function lists; Enterprise COBOL 6.4 What's New - new CONTENT-OF intrinsic function, user-defined functions and function prototypes; Micro Focus Visual COBOL 3.0 PU12, COBOL Language Reference, 'Definitions of Functions' table (live microfocus.com now serves a JS marketing shell; retrieved from the Internet Archive copy of the vendor page); Micro Focus COBOL Language Reference, 'Intrinsic Functions' chapter intro; Micro Focus COBOL Language Reference, 'Definitions of Functions' table; ACUCOBOL-GT 10.0.1 Reference Manual, Appendix F 'Intrinsic Functions' > 'Function Definitions' table (live page now a JS marketing shell; Internet Archive copy of the vendor page); FUJITSU Software NetCOBOL V11.0 User's Guide (B1WD-3306-01ENZ0), Appendix D 'Intrinsic Function List', Table D.1 (software.fujitsu.com now answers curl with a JS security checkpoint; Internet Archive copy of the vendor PDF); Fujitsu NetCOBOL FAQ #3880, which spells the UCS2-OF function name in text (used only to attest that spelling); Veryant isCOBOL Evolve 2021R2, Appendices > 'Intrinsic Functions' - 'The table below shows all available intrinsic functions'; NIST SP 500-203, Conformance test specifications for COBOL intrinsic function module - the 42 functions of ANSI X3.23A-1989 (the Intrinsic Function Addendum carried into the later editions); INCITS (the US national body for COBOL) announcement of ISO/IEC 1989:2023, reproducing the third edition's 'The main changes are as follows' list - the COUNT-family evidence; ISO/IEC 1989:2023 free preview (cover, copyright page and Contents pages iii-xv): confirms the 2023 structure, including new subclause '9.1.18 Commit and Rollback'; truncated before clause 15 'Intrinsic functions'; ISO/IEC 1989:2014 free preview (Contents pages iii-xv): clause 15 'Intrinsic functions' begins at page 627 and the Contents stops at 15.3, so the per-function subclauses are not in the preview; RM/COBOL Language Reference Manual, Second Edition (Version 12, Liant Software, copyright 1985-2008, as served by supportline.microfocus.com) - negative check: no intrinsic function chapter, no occurrence of 'intrinsic', so this dialect contributed no words
//   ISO/IEC 1989, Information technology - Programming languages, their environments and system software interfaces - Programming language COBOL. Re-derived from the two public draft texts of the standard that are reachable without a paywall: (1) ISO/IEC FCD 1989:2001 (E), Final Committee Draft, working document ISO/IEC JTC 1/SC 22/WG 4 N 0147, dated 2001-01-15, circulated by the SC 22 secretariat as SC 22 N 3204 - this is the draft of the edition published as ISO/IEC 1989:2002; and (2) ISO/IEC 1989:20xx CD 1.2 (E), Committee Draft International Standard, dated 2009-08-23, distributed as file std.zip by the INCITS PL22.4 (formerly J4) COBOL Task Group - this is a draft on the track to ISO/IEC 1989:2014. The official ISO previews of ISO/IEC 1989:2014 and ISO/IEC 1989:2023 (front matter only) were used to confirm clause numbering but contain no word lists. - ISO/IEC FCD 1989:2001 (WG4 N 0147): 8.9 Reserved words, 8.10 Context-sensitive words, 8.11 Intrinsic function names, 8.12 Compiler-directive reserved words, Table 13 Exception-names; SC22 document register entry identifying N3204 as "FCD Ballot on FCD 1989 ... Cobol" (provenance); Archived INCITS PL22.4 (formerly J4) COBOL Task Group distribution of the working draft standard; contains the single member STD.BK.pdf; ISO/IEC 1989:20xx CD 1.2, dated 2009-08-23 (ISO/IEC 1989:2014 track): 8.9 Reserved words, 8.10 Context-sensitive words, 8.11 Intrinsic function names, 8.12 Compiler-directive words, Table 14 Exception-names; ISO/IEC 1989:2023 official preview (cover plus Contents through page xv only): confirms that the 2023 edition still carries 8.9 Reserved words (p.205) and 8.11 Intrinsic function names (p.213); contains no word lists; ISO/IEC 1989:2014 official preview (cover plus Contents through page xv only): 8.9 Reserved words (p.167), 8.11 Intrinsic function names (p.173), 15 Intrinsic functions (p.627); contains no word lists; IBM COBOL for Linux on x86 1.2 Language Reference, "Reserved words": corroboration only. Its third column "Potential reserved words" is stated to include "words reserved in the 2002 COBOL Standard"
//   Micro Focus Visual COBOL 9.0 COBOL Language Reference - Reserved Words Table, Context-sensitive Words Table, COBOL Words, Special registers, Definitions of Functions, The Special-Names Paragraph; with Micro Focus Net Express 3.1 Language Reference, Appendix D: Reserved Words - Reserved Words Table (and the dialect-code legend); Context-sensitive Words Table; Reserved Words (appendix front matter); COBOL Words (category definitions); Special registers; Definitions of Functions (intrinsic functions); Intrinsic Functions (chapter front matter); The Special-Names Paragraph (implementor-names = system-names); Net Express 3.1 Language Reference, Appendix D: Reserved Words
//   Reserved-word appendices of six independent COBOL implementations: Veryant isCOBOL Evolve 2025 R1 Appendices, Appendix A 'isCOBOL Reserved Words'; Heirloom Computing Elastic COBOL Language Reference Manual Appendix, revision August 2012, Appendix A 'COBOL Reserved Words' and Appendix B 'Elastic COBOL Reserved Words'; Stratus VOS COBOL Language R010-03, Appendix A 'COBOL Reserved Words'; HP COBOL Manual for TNS and TNS/R Programs, part number 522555-006, Section 21 'Reserved Words'; Unisys COBOL ANSI-85 Programming Reference Manual Volume 1, Basic Implementation, form 8600 1518-307 (February 2003), Appendix B 'Reserved Words'; VSI COBOL Reference Manual, VSI COBOL Version 3.1-7 for OpenVMS, Appendix A 'VSI COBOL for OpenVMS Reserved Words' - Stratus VOS COBOL Language (R010-03), Appendix A 'COBOL Reserved Words' - word source; Stratus VOS COBOL Language (R010-03), 'COBOL Words' - consulted to test whether the COMP-n digits are enumerated anywhere (they are not); Veryant isCOBOL Evolve 2025 R1, Appendices, Appendix A 'isCOBOL Reserved Words' - word source; Veryant isCOBOL 2025 R1 Language Reference contents - corroborates hyphen spelling (WORKING-STORAGE, SPECIAL-NAMES, FILE-CONTROL, I-O-CONTROL); Veryant isCOBOL 2025 R1 Language Reference, PERFORM - corroborates hyphen spelling (END-PERFORM); Heirloom Computing, Elastic COBOL Language Reference Manual Appendix (rev. August 2012), Appendix A 'COBOL Reserved Words' and Appendix B 'Elastic COBOL Reserved Words' - word source; Heirloom Computing, Elastic COBOL Language Reference Manual - consulted for a separate intrinsic-function name list; its chapter 15 defines function semantics but publishes no extractable name table; HP COBOL Manual for TNS and TNS/R Programs (HP part number 522555-006), Section 21 'Reserved Words', sub-lists 'All Reserved Words' and 'HP Reserved Words' - word source; Unisys COBOL ANSI-85 Programming Reference Manual Volume 1, Basic Implementation (form 8600 1518-307, Feb 2003), Appendix B 'Reserved Words' - word source; VSI COBOL Reference Manual, VSI COBOL Version 3.1-7 for OpenVMS, Appendix A 'VSI COBOL for OpenVMS Reserved Words' - word source; COBOL-IT Compiler Suite Getting Started v4.1 - PROVENANCE EVIDENCE ONLY, no words taken from it: establishes the OpenCOBOL lineage on which COBOL-IT was excluded; Broadcom TechDocs 'CA Realia II Workbench' bookshelf - GAP EVIDENCE: names the COBOL Reference Guide 3.3 (b009451e.pdf) and 3.2 (b009341e.pdf) whose PDFs sit behind Broadcom OAuth

export const RESERVED_WORDS = new Set(`3-D ABORT-TRANSACTION ABSENT ABSTRACT ACCEPT ACCESS ACQUIRE ACTION ACTIVE-CLASS ACTIVE-X ACTUAL ADD
ADDRESS ADDRESS-ARRAY ADDRESS-OFFSET ADJUSTABLE-COLUMNS ADVANCE ADVANCING AFP-5A AFTER ALIAS ALIGNED
ALL ALLOCATE ALLOW ALLOWING ALPHABET ALPHABETIC ALPHABETIC-HIGHER ALPHABETIC-LOWER ALPHABETIC-UPPER
ALPHANUMERIC ALPHANUMERIC-EDITED ALSO ALTER ALTERING ALTERNATE ALTERNATIVE AND ANSI ANY ANYCASE
APPLY APPROXIMATE ARE AREA AREA-VALUE AREAS ARGUMENT-NUMBER ARGUMENT-VALUE ARITHMETIC AS ASA
ASCENDING ASCII ASSEMBLY-ATTRIBUTES ASSEMBLY-NAME ASSERT ASSIGN AT ATTACH ATTACH-OPTIONS ATTRIBUTE
AUDIT AUTHOR AUTO AUTO-DECIMAL AUTO-HYPHEN-SKIP AUTO-MINIMIZE AUTO-RESIZE AUTO-SKIP AUTO-SPIN
AUTOMATIC AUTOTERMINATE AVAILABLE AX-EVENT-LIST B-AND B-EXOR B-LEFT B-LESS B-NOT B-OR B-RIGHT
B-SHIFT-L B-SHIFT-LC B-SHIFT-R B-SHIFT-RC B-XOR BACKGROUND BACKGROUND-COLOR BACKGROUND-COLOUR
BACKGROUND-HIGH BACKGROUND-LOW BACKGROUND-STANDARD BACKUP BACKWARD BAR BASED BASED-STORAGE BASIS
BATCH BECOMES BEEP BEFORE BEGIN-TRANSACTION BEGINNING BELL BINARY BINARY-BYTE BINARY-CHAR
BINARY-DOUBLE BINARY-LONG BINARY-SHORT BIND BIT BITMAP BITMAP-END BITMAP-HANDLE BITMAP-NUMBER
BITMAP-RAW-HEIGHT BITMAP-RAW-WIDTH BITMAP-SCALE BITMAP-START BITMAP-TIMER BITMAP-TRAILING
BITMAP-WIDTH BITS BLANK BLINK BLINKING BLOB-FILE BLOB-LOCATOR BLOCK BMP BOLD BOOLEAN BOTTOM BOX
BOXED BRIGHT BROWSING BSN BUILD BULK-ADDITION BUTTONS BY BYTE BYTE-LENGTH BYTES C01 C02 C03 C04 C05
C06 C07 C08 C09 C10 C11 C12 CALENDAR-FONT CALL CALL-CONVENTION CALLED CANCEL CANCEL-BUTTON CARDS
CASE CASE-INSENSITIVE CASSETTE CAST CASTING CATALOGUE-NAME CATALOGUED CATCH CAUSE CBL CBL-CTR CCOL
CD CELL CELL-COLOR CELL-DATA CELL-FONT CELL-PROTECTION CELLS CENTER CENTERED CENTERED-HEADINGS
CENTURY-DATE CENTURY-DAY CF CH CHAIN CHAINING CHANGE CHANGED CHANNEL CHAR-VARYING CHARACTER
CHARACTER-SET CHARACTERS CHART CHECK CHECK-BOX CHECKING CHECKPOINT CHECKPOINT-FILE CLASS
CLASS-ATTRIBUTES CLASS-CONTROL CLASS-ID CLASS-NAME CLASS-OBJECT CLASSIFICATION CLEAR-SELECTION
CLIENT CLINE CLINES CLOB CLOB-FILE CLOB-LOCATOR CLOCK-UNITS CLOSE COBOL CODE CODE-SET COERCION COL
COLLATING COLOR COLORS COLOUR COLOURS COLS COLUMN COLUMN-COLOR COLUMN-DIVIDERS COLUMN-FONT
COLUMN-HEADINGS COLUMN-PROTECTION COLUMNS COM-REG COMBO-BOX COMMA COMMAND COMMAND-LINE COMMIT
COMMITMENT COMMON COMMUNICATION COMP COMP-0 COMP-1 COMP-1-MVS COMP-1-REV COMP-10 COMP-11 COMP-12
COMP-13 COMP-14 COMP-15 COMP-2 COMP-2-MVS COMP-2-REV COMP-3 COMP-4 COMP-5 COMP-6 COMP-7 COMP-8
COMP-9 COMP-D COMP-N COMP-S COMP-X COMPL COMPLEMENTARY COMPLEX COMPONENT COMPRESSION COMPUTATIONAL
COMPUTATIONAL-0 COMPUTATIONAL-1 COMPUTATIONAL-1-MVS COMPUTATIONAL-1-REV COMPUTATIONAL-10
COMPUTATIONAL-11 COMPUTATIONAL-12 COMPUTATIONAL-13 COMPUTATIONAL-14 COMPUTATIONAL-15 COMPUTATIONAL-2
COMPUTATIONAL-2-MVS COMPUTATIONAL-2-REV COMPUTATIONAL-3 COMPUTATIONAL-4 COMPUTATIONAL-5
COMPUTATIONAL-6 COMPUTATIONAL-7 COMPUTATIONAL-8 COMPUTATIONAL-9 COMPUTATIONAL-D COMPUTATIONAL-N
COMPUTATIONAL-S COMPUTATIONAL-X COMPUTE CONCURRENT CONDITION CONDITION-CODE CONDITION-VALUE
CONDITIONALLY CONFIGURATION CONNECT CONSOLE CONSTANT CONSTRAIN CONSTRAINTS CONSTRUCTOR CONTAIN
CONTAINED CONTAINS CONTENT CONTINUE CONTROL CONTROL-AREA CONTROL-CHARACTER CONTROL-POINT CONTROLS
CONTROLS-UNCROPPED CONV CONV-SIZE CONV-STATUS CONVERSATION CONVERSION CONVERT CONVERTING COPY
COPY-SELECTION CORE-INDEX CORR CORRESPONDING COUNT COUNT-MAX COUNT-MIN CRCR-INPUT CRCR-OUTPUT CREATE
CREATING CRP CRT CRT-UNDER CRUNCH CS-BASIC CS-GENERAL CSIZE CSP CULTURE CURRENCY CURRENT
CURRENT-DATE CURRENT-THREAD CURSOR CURSOR-COL CURSOR-COLOR CURSOR-FRAME-WIDTH CURSOR-ROW CURSOR-X
CURSOR-Y CUSTOM-ATTRIBUTE CUSTOM-PRINT-TEMPLATE CYCLE CYL-INDEX CYL-OVERFLOW CYLINDER DASHED DATA
DATA-BASE DATA-COLUMNS DATA-POINTER DATA-TYPES DATABASE-EXCEPTION DATABASE-KEY DATABASE-KEY-LONG
DATE DATE-AND-TIME DATE-COMPILED DATE-ENTRY DATE-RECORD DATE-WRITTEN DAY DAY-AND-TIME DAY-OF-WEEK DB
DB-ACCESS-CONTROL-KEY DB-CONDITION DB-CONFLICT DB-CURRENT-RECORD-ID DB-CURRENT-RECORD-NAME DB-CXT
DB-DATA-NAME DB-DESCRIPTIONS DB-DETAILED-STATUS DB-EXCEPTION DB-FORMAT-NAME DB-KEY DB-KEY-NAME
DB-MESSAGE-LENGTH DB-MESSAGE-TEXT DB-PARAMETERS DB-PRIVACY-KEY DB-REALM-NAME DB-RECORD-NAME
DB-REGISTERS DB-SET-NAME DB-STATEMENT-CODE DB-STATUS DB-STATUS-CODE DB-UWA DBCLOB DBCLOB-FILE
DBCLOB-LOCATOR DBCS DBKEY DE DE-EDITING DEAD-LOCK DEADLOCK DEBUG DEBUG-CONTENTS DEBUG-ITEM
DEBUG-LENGTH DEBUG-LINE DEBUG-NAME DEBUG-NUMERIC-CONTENTS DEBUG-SIZE DEBUG-START DEBUG-SUB
DEBUG-SUB-1 DEBUG-SUB-2 DEBUG-SUB-3 DEBUG-SUB-ITEM DEBUG-SUB-N DEBUG-SUB-NUM DEBUGGING DECIMAL
DECIMAL-POINT DECLARATIVES DECLARE DEFAULT DEFAULT-BUTTON DEFINE DEFINED DEFINITION DELEGATE
DELEGATE-ID DELETE DELIMITED DELIMITER DEPENDENCY DEPENDING DESCENDING DESCRIPTOR DESTINATION
DESTINATION-1 DESTINATION-2 DESTINATION-3 DESTROY DETACH DETAIL DEVICE DICTIONARY DIM DIRECT DISABLE
DISALLOW DISC DISCARD DISCONNECT DISJOINING DISK DISMISS DISP DISPLAY DISPLAY-1 DISPLAY-2 DISPLAY-3
DISPLAY-4 DISPLAY-6 DISPLAY-7 DISPLAY-9 DISPLAY-COLUMNS DISPLAY-EXIT DISPLAY-FORMAT DISPLAY-ST
DISPLAY-WS DIVIDE DIVIDER-COLOR DIVIDERS DIVISION DMCANCEL DMCLOSE DMDELETE DMERROR DMOPEN DMREMOVE
DMSAVE DMSET DMSTATUS DMSTRUCTURE DMTERMINATE DOCUMENT DOES DOT-DASH DOTTED DOUBLE DOWN DRAG-COLOR
DRAW DROP DROP-DOWN DROP-LIST DTD DUMP DUPLICATE DUPLICATES DYNAMIC EBCDIC EC ECHO EDIT-COLOR
EDIT-CURSOR EDIT-MODE EDIT-OPTION EDIT-STATUS EDITING EGCS EGI EJECT ELEMENT ELEMENTARY ELSE EMI
EMPTY EMPTY-CHECK ENABLE ENABLED ENCODING ENCRYPTION END END-ABORT-TRANSACTION END-ACCEPT END-ADD
END-ASSIGN END-BEGIN-TRANSACTION END-BUILD END-CALL END-CANCEL END-CHAIN END-CLASS END-CLOSE
END-COLOR END-COMMIT END-COMPUTE END-CONNECT END-COPY END-CREATE END-DECLARATIVES END-DELEGATE
END-DELETE END-DISABLE END-DISCONNECT END-DISPLAY END-DIVIDE END-ENABLE END-END-TRANSACTION
END-ERASE END-EVALUATE END-EVENT END-EXEC END-FETCH END-FIND END-FINISH END-FREE END-GENERATE
END-GET END-HIDE END-IF END-INSERT END-INSTRING END-INVOKE END-JSON END-KEEP END-LOCK END-METHOD
END-MODIFY END-MOVE END-MULTIPLY END-OF-PAGE END-OPEN END-PERFORM END-PROGRAM END-READ END-READY
END-RECEIVE END-RECONNECT END-RECREATE END-REMOVE END-REPLACE END-RETURN END-REWRITE END-ROLLBACK
END-SAVE END-SEARCH END-SECURE END-SEND END-SET END-SHOW END-START END-STORE END-STRING END-SUBTRACT
END-SYNC END-SYNCHRONIZED END-THREAD END-TRANSACTION END-TRANSCEIVE END-TRY END-UNSTRING END-USE
END-WAIT END-WRITE END-XML ENDCOBOL ENDING ENSURE-VISIBLE ENTER ENTRY ENTRY-CONVENTION ENTRY-FIELD
ENTRY-REASON ENUM ENUM-ID ENVIRONMENT ENVIRONMENT-NAME ENVIRONMENT-VALUE EO EOL EOP EOS EQUAL EQUALS
ERASE ERROR ESCAPE ESCAPE-BUTTON ESI EVALUATE EVENT EVENT-LIST EVENT-POINTER EVERY EXACT EXAMINE
EXCEEDS EXCEPTION EXCEPTION-OBJECT EXCEPTION-VALUE EXCESS-3 EXCLUDE-EVENT-LIST EXCLUSIVE EXEC
EXECUTE EXHIBIT EXIT EXOR EXPAND EXPANDS EXTEND EXTENDED EXTENDED-SEARCH EXTENDED-STORAGE EXTENSION
EXTERNAL EXTERNAL-FORM EXTERNAL-FORMAT EXTERNALLY-DESCRIBED-KEY FAC FACTORY FAILURE FALSE FD FETCH
FH--FCD FH--KEYDEF FIELD FIGURATIVE-CONSTANTS FILE FILE-CONTROL FILE-ID FILE-LIMIT FILE-LIMITS
FILE-NAME FILE-PATH FILE-POS FILE-PREFIX FILE-SECTION FILES FILL-COLOR FILL-COLOR2 FILL-PERCENT
FILLER FINAL FINALLY FIND FINISH FINISH-REASON FIRST FIXED FIXED-WIDTH FLADD FLAG-85
FLAG-NATIVE-ARITHMETIC FLAT FLAT-BUTTONS FLOAT FLOAT-BINARY-16 FLOAT-BINARY-34 FLOAT-BINARY-7
FLOAT-DECIMAL-16 FLOAT-DECIMAL-34 FLOAT-EXTENDED FLOAT-INFINITY FLOAT-LONG FLOAT-SHORT FLOATING FLR
FONT FOOTING FOR FOREGROUND FOREGROUND-COLOR FOREGROUND-COLOUR FOREVER FORM FORM-KEY FORMAT
FORMATTED FRAMED FREE FROM FULL FULL-HEIGHT FUNCTION FUNCTION-ARGUMENT FUNCTION-ID FUNCTION-POINTER
GCOS GCR GENERATE GENERIC GET GETTER GIVING GLOBAL GO GO-BACK GO-FORWARD GO-HOME GO-SEARCH GOBACK
GOTO GRAPHICAL GREATER GRID GRIDLINE GRIP GROUP GROUP-USAGE GROUP-VALUE GUARDIAN-ERR HANDLE HEADING
HEADING-COLOR HEADING-DIVIDER-COLOR HEADING-FONT HEAVY HEIGHT HEIGHT-IN-CELLS HELP-ID HIDDEN-DATA
HIDE HIGH HIGH-COLOR HIGH-VALUE HIGH-VALUES HIGHEST-VALUE HIGHLIGHT HOLD HOT-TRACK HSCROLL
HSCROLL-POS I-O I-O-CONTROL ICON ID IDENT IDENTIFICATION IDENTIFIED IDS-II IF IGNORE IGNORING IMP
IMPLEMENTS IN INCLUDE INCLUDING INDEPENDENT INDEX INDEX-1 INDEX-2 INDEXED INDEXED-EXT INDEXER
INDEXER-ID INDIC INDICATE INDICATOR INDICATORS INFINITY INHERITING INHERITS INITIAL INITIAL-VALUE
INITIALIZE INITIALIZED INITIATE INPUT INPUT-OUTPUT INQUIRE INQUIRY INSERT INSERT-ROWS
INSERTION-INDEX INSPECT INSTALLATION INSTANCE INT INTEGER INTERFACE INTERFACE-ID INTERNAL
INTERROGATE INTERRUPT INTO INTRINSIC INVALID INVARIANT INVOKE INVOKED INVOKING IO IS ITEM-BOLD
ITEM-ID ITEM-TEXT ITEM-TO-ADD ITEM-TO-DELETE ITEM-TO-EMPTY ITEM-VALUE ITERATOR ITERATOR-ID JAPANESE
JAVA JAVA-PARAMETER JAVA-RETURN JNIENVPTR JOB JOINED JOINING JSON JSON-CODE JSON-STATUS JUST
JUSTIFIED JUSTIFY KANJI KEEP KEPT KEY KEY-LOCATION KEY-YY KEYBOARD KEYED KEYS LABEL LABEL-OFFSET
LABEL-RETURN LAST LAST-ROW LAYOUT-DATA LAYOUT-MANAGER LB LD LEADING LEADING-SHIFT LEAP-SECOND LEAVE
LEFT LEFT-JUSTIFY LEFT-TEXT LEFTLINE LENGTH LENGTH-CHECK LESS LIKE LIMIT LIMITED LIMITS LIN LINAGE
LINAGE-COUNTER LINE LINE-COUNTER LINES LINES-AT-ROOT LINES-PER-PAGE LINK LINKAGE LIST LIST-BOX
LISTING LOC LOCAL LOCAL-STORAGE LOCALE LOCALIZE LOCALLY LOCATION LOCK LOCK-HOLDING LOCKED LOCKFILE
LOCKING LOCKS LONG LONG-DATE LONG-VARBINARY LONG-VARCHAR LOW LOW-COLOR LOW-VALUE LOW-VALUES LOWER
LOWER-BOUND LOWER-BOUNDS LOWERED LOWEST-VALUE LOWLIGHT MANUAL MASK MASS-UPDATE MASTER-INDEX MATCH
MATCHES MATCHING MAX-HEIGHT MAX-LINES MAX-PROGRESS MAX-SIZE MAX-TEXT MAX-VAL MAX-VALUE MDI-CHILD
MDI-FRAME MEMBER MEMBERS MEMBERSHIP MEMORY MENU MERGE MESSAGE MESSAGES METACLASS METHOD METHOD-ID
MID-TRANSACTION MIN-HEIGHT MIN-LINES MIN-SIZE MIN-VAL MIN-VALUE MIN-WIDTH MINIMUM-DB-KEY MINUS MODAL
MODE MODE-1 MODE-2 MODE-3 MODELESS MODIFIED MODIFY MODULE MODULES MONITOR-POINTER MONITORED
MORE-LABELS MOVE MULITPLY MULTICON MULTICONVERSATION-MODE MULTILINE MULTIPLE MULTIPLY MUTEX-POINTER
NAME NAMED NAMESPACE NAMESPACE-PREFIX NATIONAL NATIONAL-EDITED NATIVE NAVIGATE-URL NCHAR NCLOB
NEGATIVE NESTED NET-EVENT-LIST NEW NEWABLE NEXT NEXT-ITEM NO NO-AUDIT NO-AUTO-DEFAULT NO-AUTOSEL
NO-BOX NO-CELL-DRAG NO-CLOSE NO-DIVIDERS NO-ECHO NO-F4 NO-FOCUS NO-GROUP-TAB NO-KEY-LETTER NO-SEARCH
NO-TAB NO-UPDOWN NODISPLAY NOLIST NOMINAL NON-NULL NONE NORMAL NOT NOTE NOTHING NOTIFY NOTIFY-CHANGE
NOTIFY-DBLCLICK NOTIFY-SELCHANGE NSTD-REELS NULL NULLABLE NULLS NUM-COL-HEADINGS NUM-ROW-HEADINGS
NUM-ROWS NUMBER NUMBER-OF-PAGES NUMBERS NUMERIC NUMERIC-EDITED NUMERIC-FILL NUMVAL O-FILL OBJECT
OBJECT-COMPUTER OBJECT-ID OBJECT-PROGRAM OBJECT-REFERENCE OBJECT-STORAGE OCCURENCE OCCURS ODT
ODT-INPUT-PRESENT OF OFF OFFER OFFSET OK-BUTTON OLE OMITTED ON ONLY OOSTACKPTR OPEN OPERATIONAL
OPERATOR OPERATOR-ID OPTIONAL OPTIONS OR ORDER ORGANIZATION OTHER OTHERS OTHERWISE OUTPUT OVERFLOW
OVERLAP-LEFT OVERLAP-TOP OVERLAPPED OVERLINE OVERRIDE OVERRIDING OWN OWNER PACKED-DECIMAL PADDING
PAGE PAGE-COUNTER PAGE-SETUP PAGE-SIZE PAGED PALETTE PANEL-INDEX PANEL-STYLE PANEL-TEXT PANEL-WIDTHS
PAPERTAPE PARAGRAPH PARAMETER PARAMS PARSE PARTIAL PASCAL PASSWORD PERFORM PERFORMS PERMANENT PF
PFKEY PFKEYS PH PHASE-ENCODED PHYSICAL PIC PICTURE PIXEL PIXELS PLUS POINT POINTER POINTER-24
POINTER-31 POINTER-32 POINTER-64 POP-UP PORT POS POSITION POSITION-SHIFT POSITIONING POSITIVE
PREATTACHED PREFIX PREFIXING PRESENT PREVIOUS PRIMARY PRINT PRINT-CONTROL PRINT-NO-PROMPT
PRINT-PREVIEW PRINT-SWITCH PRINTER PRINTER-1 PRINTING PRIOR PRIORITY PRIVATE PROCEDURE
PROCEDURE-NAME PROCEDURE-POINTER PROCEDURES PROCEED PROCESS PROCESS-AREA PROCESSING PROGRAM
PROGRAM-ID PROGRAM-LIBRARY PROGRAM-POINTER PROGRAM-STATUS PROGRAM-STATUS-1 PROGRAM-STATUS-2 PROMPT
PROPAGATE PROPERTIES PROPERTY PROPERTY-ID PROPERTY-VALUE PROTECTED PROTOTYPE PUBLIC PUNCH PURGE
PUSH-BUTTON QUERY-INDEX QUEUE QUEUED QUOTE QUOTES RADIO-BUTTON RAISE RAISING RANDOM RANGE RAW RD
RE-START READ READ-OK READ-ONLY READER READERS READING READY REAL REALM REALM-NAME REALMS RECEIVE
RECEIVE-CONTROL RECEIVED RECONNECT RECORD RECORD-DATA RECORD-KEY RECORD-NAME RECORD-OVERFLOW
RECORD-POSITION RECORD-TO-ADD RECORD-TO-DELETE RECORDING RECORDS RECREATE RECURSIVE REDEFINE
REDEFINES REDEFINITION REEL REF REFERENCE REFERENCE-MODIFIER REFERENCES REFRESH REGARDLESS
REGION-COLOR RELATION RELATIVE RELEASE RELOAD REMAINDER REMARKS REMOTE REMOVAL REMOVE RENAMES
REORG-CRITERIA REPEATED REPLACE REPLACING REPLY REPORT REPORTING REPORTS REPOSITORY
REPRESENTS-NOT-A-NUMBER REQUIRED REREAD RERUN RESERVE RESERVED RESET RESET-GRID RESET-LIST
RESET-SET-LOCATOR RESET-TABS RESIDENT RESIZABLE RESTRICTED RESULT RESUME RETAINING RETENTION
RETRIEVAL RETRY RETURN RETURN-CODE RETURN-UNSIGNED RETURNING REVERSE REVERSE-VIDEO REVERSED REWIND
REWRITE RF RH RIGHT RIGHT-ALIGN RIGHT-JUSTIFY RIMMED RMS-CURRENT-FILENAME RMS-CURRENT-STS
RMS-CURRENT-STV RMS-FILENAME RMS-STS RMS-STV ROLL-OUT ROLLBACK ROLLING ROUNDED ROW ROW-COLOR
ROW-COLOR-PATTERN ROW-DIVIDERS ROW-FONT ROW-HEADINGS ROW-PROTECTION ROWID RUN RUN-UNIT S01 S02 S03
S04 S05 SA SAME SARF SAVE SAVE-AS SAVE-AS-NO-PROMPT SAVED-AREA SCHEMA SCREEN SCROLL SCROLL-BAR SD
SEARCH SEARCH-OPTIONS SEARCH-TEXT SECONDARY SECONDS SECTION SECURE SECURITY SEEK SEGMENT
SEGMENT-LIMIT SELECT SELECT-ALL SELECTED SELECTION SELECTION-INDEX SELECTION-TEXT SELECTIVE SELF
SELF-ACT SELFCLASS SEMAPHORE-POINTER SEND SENTENCE SEPARATE SEPARATION SEQUENCE SEQUENCE-NUMBER
SEQUENTIAL SERVICE SERVLET-IN SERVLET-OUT SERVLETIN SERVLETOUT SESSION SESSION-ID SET SET-SELECTION
SETS SETTER SHADING SHADOW SHARED SHARING SHIFT-IN SHIFT-OUT SHORT SHORT-DATE SHOW SHOW-LINES
SHOW-NONE SHOW-SEL-ALWAYS SIGN SIGNED SIGNED-INT SIGNED-LONG SIGNED-SHORT SIMPLE SINGLE SIZE SKIP1
SKIP2 SKIP3 SORT SORT-CCSN SORT-CONTROL SORT-CORE-SIZE SORT-EOW SORT-FILE-SIZE SORT-MERGE
SORT-MESSAGE SORT-MODE-SIZE SORT-OPTION SORT-ORDER SORT-RETURN SORT-STATUS SORT-TAPE SORT-TAPES
SORT-WORK SORTED SOURCE SOURCE-COMPUTER SOURCES SPACE SPACE-FILL SPACES SPECIAL-NAMES SQL SQL-BFILE
SQL-BLOB SQL-CLOB SQL-CURSOR SQL-NCLOB SQL-ROWID SQLIMS SSF STACK STANDARD STANDARD-1 STANDARD-2
STANDARD-3 START START-X START-Y STARTBACKUP STARTING STATEMENT STATIC STATIC-LIST STATION STATIONS
STATUS STATUS-BAR STATUS-TEXT STDCALL STEP STOP STOP-BROWSER STOQ-INPUT STOQ-OUTPUT STORE STREAM
STRING STRONG STRONG-NAME STRUCTURE STYLE SUB-QUEUE-1 SUB-QUEUE-2 SUB-QUEUE-3 SUB-SCHEMA SUBFILE
SUBPROGRAM SUBRANGE SUBSCHEMA-NAME SUBSTITUTION SUBSTRACT SUBTRACT SUBWINDOW SUCCESS SUCCESSIVE
SUFFIX SUFFIXING SUM SUPER SUPPRESS SUPPRESSING SUSPEND SW1 SW2 SW3 SW4 SW5 SW6 SW7 SW8 SWITCH
SWITCH-1 SWITCH-10 SWITCH-11 SWITCH-12 SWITCH-13 SWITCH-14 SWITCH-15 SWITCH-16 SWITCH-17 SWITCH-18
SWITCH-19 SWITCH-2 SWITCH-20 SWITCH-21 SWITCH-22 SWITCH-23 SWITCH-24 SWITCH-25 SWITCH-26 SWITCH-27
SWITCH-28 SWITCH-29 SWITCH-3 SWITCH-30 SWITCH-4 SWITCH-5 SWITCH-6 SWITCH-7 SWITCH-8 SWITCH-9 SYMBOL
SYMBOLIC SYNC SYNCDEPTH SYNCHRONIZED SYSERR SYSIN SYSIPT SYSLIST SYSLST SYSOPT SYSOUT SYSOUT-FLUSH
SYSPCH SYSPUNCH SYSTEM SYSTEM-DEFAULT SYSTEM-INFO SYSTEM-SWITCH-1 SYSTEM-SWITCH-10 SYSTEM-SWITCH-2
SYSTEM-SWITCH-3 SYSTEM-SWITCH-4 SYSTEM-SWITCH-5 SYSTEM-SWITCH-6 SYSTEM-SWITCH-7 SYSTEM-SWITCH-8
SYSTEM-SWITCH-9 SYSTEMERROR TAB TAB-CONTROL TAB-TO-ADD TAB-TO-DELETE TABLE TAG-KEY TAG-SEARCH TAL
TALLY TALLYING TAPE TAPES TASK TEMP TENANT TENNANT TERMINAL TERMINAL-INFO TERMINATE
TERMINATION-VALUE TEST TEXT THAN THEN THREAD THREAD-LOCAL THREAD-LOCAL-STORAGE THREAD-POINTER
THREADS THROUGH THRU THUMB-POSITION TILED-HEADINGS TIME TIME-OF-DAY TIME-OUT TIME-RECORD TIMEOUT
TIMES TIMESTAMP-OFFSET TIMESTAMP-OFFSET-RECORD TIMESTAMP-RECORD TITLE TITLE-BAR TITLE-POSITION TO
TODAYS-DATE TODAYS-NAME TOOL-BAR TOP TOTALED TOTALING TRACE TRACE-OFF TRACE-ON TRACK TRACK-AREA
TRACK-LIMIT TRACK-OVERFLOW TRACK-THUMB TRACKS TRAILING TRAILING-SHIFT TRAILING-SIGN TRANSACTION
TRANSACTION-STATUS TRANSCEIVE TRANSFORM TRANSPARENT-COLOR TREE-VIEW TRIMMED TRUE TRY TSW-1 TSW-31
TURN TYPE TYPEDEF UCS-2 UCS-4 UFF UN-EXCLUSIVE UNBIND UNBOUNDED UNDERLINE UNDERLINED UNEQUAL
UNFRAMED UNICODE1 UNIT UNITS UNIVERSAL UNLOCK UNLOCKFILE UNLOCKRECORD UNSIGNED UNSIGNED-INT
UNSIGNED-LONG UNSIGNED-SHORT UNSORTED UNSTRING UNTIL UP UPDATE UPDATERS UPON UPPER UPSI-0 UPSI-1
UPSI-2 UPSI-3 UPSI-4 UPSI-5 UPSI-6 UPSI-7 USAGE USAGE-MODE USE USE-ALT USE-RETURN USE-TAB USER
USER-COLORS USER-DEFAULT USER-GRAY USER-WHITE USING USW-1 USW-10 USW-11 USW-12 USW-13 USW-14 USW-15
USW-16 USW-17 USW-18 USW-19 USW-2 USW-20 USW-21 USW-22 USW-23 USW-24 USW-25 USW-26 USW-27 USW-28
USW-29 USW-3 USW-30 USW-31 USW-4 USW-5 USW-6 USW-7 USW-8 USW-9 UTF-16 UTF-8 VAL-STATUS VALID
VALIDATE VALIDATE-STATUS VALIDATING VALIDITY VALUE VALUE-FORMAT VALUES VALUETYPE VALUETYPE-ID
VARBINARY VARIABLE VARIANT VARYING VERSION VERSION-XML VERY-HEAVY VFU-CHANNEL VIA VIRTUAL
VIRTUAL-WIDTH VISIBLE VLR VOLATILE VPADDING VSCROLL VSCROLL-BAR VSCROLL-POS VTOP WAIT WEB-BROWSER
WHEN WHEN-COMPILED WHERE WHILE WIDE WIDTH WIDTH-IN-CELLS WINDOW WITH WITHIN WORDS WORKING-STORAGE
WRAP WRITE WRITE-OK WRITE-ONLY WRITE-VERIFY WRITERS WRITING XML XML-CODE XML-DECLARATION XML-EVENT
XML-INFORMATION XML-NAMESPACE XML-NAMESPACE-PREFIX XML-NNAMESPACE XML-NNAMESPACE-PREFIX XML-NTEXT
XML-SCHEMA XML-TEXT YEAR YIELD YIELDING YYYYDDD YYYYMMDD ZERO ZERO-FILL ZERO-LENGTH ZEROES ZEROS ZIP`.split(/\s+/));

export const SPECIAL_REGISTERS = new Set(`ADDRESS CBL-CTR COB-CRT-STATUS CONV-SIZE CONV-STATUS COUNT COUNT-MAX COUNT-MIN CURRENT-DATE
DEBUG-ITEM EDIT-COLOR EDIT-CURSOR EDIT-MODE EDIT-OPTION EDIT-OPTION2 EDIT-OPTION3 EDIT-STATUS
ENVIRONMENT-NAME FILE-PREFIX HIGHEST-VALUE IGY-JAVAIOP-CALL-EXCEPTION INITIAL-VALUE JNIENVPTR
JSON-CODE JSON-STATUS LABEL-RETURN LENGTH LINAGE-COUNTER LINE-COUNTER LOWEST-VALUE MAX-VALUE
MIN-VALUE NUMBER-OF-CALL-PARAMETERS PAGE-COUNTER PRINT-SWITCH PROCEDURE-NAME PROGRAM-ID
PROGRAM-STATUS RETURN-CODE RETURN-UNSIGNED SHIFT-IN SHIFT-OUT SORT-CCSN SORT-CONTROL SORT-CORE-SIZE
SORT-EOW SORT-FILE-SIZE SORT-MESSAGE SORT-MODE-SIZE SORT-RETURN SORT-STATUS TALLY TIME-OF-DAY
WHEN-COMPILED XML-CODE XML-EVENT XML-INFORMATION XML-NAMESPACE XML-NAMESPACE-PREFIX XML-NNAMESPACE
XML-NNAMESPACE-PREFIX XML-NTEXT XML-TEXT`.split(/\s+/));

export const SYSTEM_NAMES = new Set(`AFP-5A ALTERNATE-CONSOLE ALTERNATE-CONSOLE-0 ALTERNATE-CONSOLE-1 ALTERNATE-CONSOLE-2
ALTERNATE-CONSOLE-3 ALTERNATE-CONSOLE-X ARGUMENT-NUMBER ARGUMENT-VALUE ASCII BINARY-SEQUENTIAL BLACK
BLUE BROWN C01 C02 C03 C04 C05 C06 C07 C08 C09 C10 C11 C12 CARD-PUNCH CARD-READER CASSETTE
CHANNEL-01 CHANNEL-02 CHANNEL-1 CHANNEL-10 CHANNEL-11 CHANNEL-12 CHANNEL-2 CHANNEL-3 CHANNEL-4
CHANNEL-5 CHANNEL-6 CHANNEL-7 CHANNEL-8 CHANNEL-9 COMMAND-LINE COMPILER-INFO CONSOLE CONSOLE-0
CONSOLE-1 CONSOLE-2 CONSOLE-3 CONSOLE-X CPU-TIME CSP CTL CYAN DATE-ISO4 DEFAULT-FONT DISC DISK
EBCDIC ENVIRONMENT-NAME ENVIRONMENT-VALUE F0102 F0201 F0202 FILE-ID FIXED-FONT FORMFEED GBCD GREEN
H0202 HBCD HSC IBCD JIS KEYBOARD LARGE-FONT LINE-SEQUENTIAL LISTING LM-RESIZE MAGENTA MAGNETIC-TAPE
MEDIUM-FONT NATIVE PRINT PRINTER PRINTER-1 PRINTER01 PRINTER99 PROCESS-INFO RED S01 S02 S03 S04 S05
SLC SMALL-FONT SORT-WORK STACKER-01 STACKER-02 STANDARD-1 STANDARD-2 STDERR STDIN STDOUT SW0 SW10
SW11 SW12 SW13 SW14 SW15 SW9 SWITCH SWITCH-0 SWITCH-1 SWITCH-10 SWITCH-11 SWITCH-12 SWITCH-13
SWITCH-14 SWITCH-15 SWITCH-16 SWITCH-17 SWITCH-18 SWITCH-19 SWITCH-2 SWITCH-20 SWITCH-21 SWITCH-22
SWITCH-23 SWITCH-24 SWITCH-25 SWITCH-26 SWITCH-27 SWITCH-28 SWITCH-29 SWITCH-3 SWITCH-30 SWITCH-31
SWITCH-4 SWITCH-5 SWITCH-6 SWITCH-7 SWITCH-8 SWITCH-9 SYSERR SYSIN SYSIN-0 SYSIN-1 SYSIN-2 SYSIN-3
SYSIN-X SYSIPT SYSLIST SYSLST SYSOPT SYSOUT SYSOUT-0 SYSOUT-1 SYSOUT-2 SYSOUT-3 SYSOUT-FLUSH
SYSOUT-X SYSPCH SYSPUNCH TAB TERMINAL TERMINAL-0 TERMINAL-1 TERMINAL-2 TERMINAL-3 TERMINAL-INFO
TERMINAL-X TRADITIONAL-FONT TSW-0 TSW-1 TSW-31 UPSI-0 UPSI-1 UPSI-2 UPSI-3 UPSI-4 UPSI-5 UPSI-6
UPSI-7 UPSI-8 USW-0 USW-1 USW-10 USW-11 USW-12 USW-13 USW-14 USW-15 USW-16 USW-17 USW-18 USW-19
USW-2 USW-20 USW-21 USW-22 USW-23 USW-24 USW-25 USW-26 USW-27 USW-28 USW-29 USW-3 USW-30 USW-31
USW-4 USW-5 USW-6 USW-7 USW-8 USW-9 WHITE`.split(/\s+/));

// A REPOSITORY paragraph can make these callable without the word FUNCTION.
export const INTRINSIC_FUNCTIONS = new Set(`ABS ABSOLUTE-VALUE ACOS ACP-OF ADD-DURATION ADDR ANNUITY ASIN ATAN BIN2DEC BIT-OF BIT-TO-CHAR
BOOLEAN-OF-INTEGER BYTE-LENGTH CAPACITY CAST-ALPHANUMERIC CHAR CHAR-NATIONAL COMBINED-DATETIME
CONCAT CONCATENATE CONTENT-OF CONVERT-DATE-TIME COS CURRENT-DATE DATE-OF-INTEGER DATE-TO-YYYYMMDD
DATEVAL DAY-OF-INTEGER DAY-TO-YYYYDDD DEC2BIN DEC2HEX DEC2OCT DISPLAY-OF E ENUM-AND ENUM-NOT ENUM-OR
EXCEPTION-FILE EXCEPTION-FILE-N EXCEPTION-LOCATION EXCEPTION-LOCATION-N EXCEPTION-STATEMENT
EXCEPTION-STATUS EXP EXP10 EXTRACT-DATE-TIME FACTORIAL FIND-DURATION FORMATTED-CURRENT-DATE
FORMATTED-DATE FORMATTED-DATETIME FORMATTED-TIME FRACTION-PART HANDLE-TYPE HEX-OF HEX-TO-CHAR
HEX2DEC HIGHEST-ALGEBRAIC INTEGER INTEGER-OF-BOOLEAN INTEGER-OF-DATE INTEGER-OF-DAY
INTEGER-OF-FORMATTED-DATE INTEGER-PART LENG LENGTH LENGTH-AN LOCALE-COMPARE LOCALE-DATE LOCALE-TIME
LOCALE-TIME-FROM-SECONDS LOG LOG10 LOWER-CASE LOWEST-ALGEBRAIC MAX MEAN MEDIAN MIDRANGE MIN MOD
MODULE-CALLER-ID MODULE-DATE MODULE-FORMATTED-DATE MODULE-ID MODULE-PATH MODULE-SOURCE MODULE-TIME
NATIONAL NATIONAL-OF NUMVAL NUMVAL-C NUMVAL-F OCT2DEC ORD ORD-MAX ORD-MIN PI PRESENT-VALUE RANDOM
RANGE REM REVERSE SECONDS-FROM-FORMATTED-TIME SECONDS-PAST-MIDNIGHT SIGN SIN SQRT STANDARD-COMPARE
STANDARD-DEVIATION STORED-CHAR-LENGTH SUBSTITUTE SUBSTITUTE-CASE SUBTRACT-DURATION SUM TAN
TEST-DATE-TIME TEST-DATE-YYYYMMDD TEST-DAY-YYYYDDD TEST-FORMATTED-DATETIME TEST-NUMVAL TEST-NUMVAL-C
TEST-NUMVAL-F TRIM TRIML TRIMR UCS2-OF ULENGTH UNDATE UNICODE-OF UPOS UPPER-CASE USUBSTR
USUPPLEMENTARY UTF8-OF UTF8STRING UUID4 UVALID UWIDTH VARIANCE WHEN-COMPILED YEAR-TO-YYYY YEARWINDOW`.split(/\s+/));

// Reserved only inside the construct that gives them meaning (ISO/IEC 1989 clause 8.10). A program
// may legally use one as its own data name elsewhere, so they are kept apart from the words above.
export const CONTEXT_SENSITIVE_WORDS = new Set(`ACTIVATING ANUM ARITHMETIC AWAY-FROM-ZERO FLOAT-NOT-A-NUMBER HEX INTERMEDIATE LC_ALL LC_COLLATE
LC_CTYPE LC_MESSAGES LC_MONETARY LC_NUMERIC LC_TIME MICROSECOND-TIME NAT NEAREST-AWAY-FROM-ZERO
NEAREST-EVEN NEAREST-TOWARD-ZERO NEGATIVE-INFINITY NONNUMERIC NOT-A-NUMBER POSITIVE-INFINITY
PREFIXED PROHIBITED ROUNDING STANDARD-BINARY STANDARD-DECIMAL TOP-LEVEL TOWARD-GREATER TOWARD-LESSER
TRUNCATION TURN`.split(/\s+/));

// Reserved in compiler directives only (clause 8.12).
export const DIRECTIVE_WORDS = new Set(`CHECKING IMP LOCATION PROPAGATE`.split(/\s+/));

// Predefined exception-condition names. Not reserved words - the standard lists them separately -
// but a program names them in >>TURN and in EXCEPTION-OBJECT without declaring them.
export const EXCEPTION_CONDITIONS = new Set(`EC-ALL EC-ARGUMENT EC-ARGUMENT-FUNCTION EC-ARGUMENT-IMP EC-BOUND EC-BOUND-IMP EC-BOUND-ODO
EC-BOUND-OVERFLOW EC-BOUND-PTR EC-BOUND-REF-MOD EC-BOUND-SET EC-BOUND-SUBSCRIPT EC-BOUND-TABLE-LIMIT
EC-DATA EC-DATA-CONVERSION EC-DATA-IMP EC-DATA-INCOMPATIBLE EC-DATA-INTEGRITY EC-DATA-PTR-NULL
EC-FLOW EC-FLOW-GLOBAL-EXIT EC-FLOW-GLOBAL-GOBACK EC-FLOW-IMP EC-FLOW-RELEASE EC-FLOW-REPORT
EC-FLOW-RETURN EC-FLOW-SEARCH EC-FLOW-USE EC-FUNCTION EC-FUNCTION-NOT-FOUND EC-FUNCTION-PTR-INVALID
EC-FUNCTION-PTR-NULL EC-I-O EC-I-O-AT-END EC-I-O-EOP EC-I-O-EOP-OVERFLOW EC-I-O-FILE-SHARING
EC-I-O-IMP EC-I-O-INVALID-KEY EC-I-O-LINAGE EC-I-O-LOGIC-ERROR EC-I-O-PERMANENT-ERROR
EC-I-O-RECORD-OPERATION EC-IMP EC-LOCALE EC-LOCALE-IMP EC-LOCALE-INCOMPATIBLE EC-LOCALE-INVALID
EC-LOCALE-INVALID-PTR EC-LOCALE-MISSING EC-LOCALE-SIZE EC-OO EC-OO-CONFORMANCE EC-OO-EXCEPTION
EC-OO-IMP EC-OO-METHOD EC-OO-NULL EC-OO-RESOURCE EC-OO-UNIVERSAL EC-ORDER EC-ORDER-IMP
EC-ORDER-NOT-SUPPORTED EC-OVERFLOW EC-OVERFLOW-IMP EC-OVERFLOW-STRING EC-OVERFLOW-UNSTRING
EC-PROGRAM EC-PROGRAM-ARG-MISMATCH EC-PROGRAM-ARG-OMITTED EC-PROGRAM-CANCEL-ACTIVE EC-PROGRAM-IMP
EC-PROGRAM-NOT-FOUND EC-PROGRAM-PTR-NULL EC-PROGRAM-RECURSIVE-CALL EC-PROGRAM-RESOURCES EC-RAISING
EC-RAISING-IMP EC-RAISING-NOT-SPECIFIED EC-RANGE EC-RANGE-IMP EC-RANGE-INDEX EC-RANGE-INSPECT-SIZE
EC-RANGE-INVALID EC-RANGE-PERFORM-VARYING EC-RANGE-PTR EC-RANGE-SEARCH-INDEX
EC-RANGE-SEARCH-NO-MATCH EC-REPORT EC-REPORT-ACTIVE EC-REPORT-COLUMN-OVERLAP EC-REPORT-FILE-MODE
EC-REPORT-IMP EC-REPORT-INACTIVE EC-REPORT-LINE-OVERLAP EC-REPORT-NOT-TERMINATED
EC-REPORT-PAGE-LIMIT EC-REPORT-PAGE-WIDTH EC-REPORT-SUM-SIZE EC-REPORT-VARYING EC-SCREEN
EC-SCREEN-FIELD-OVERLAP EC-SCREEN-IMP EC-SCREEN-ITEM-TRUNCATED EC-SCREEN-LINE-NUMBER
EC-SCREEN-STARTING-COLUMN EC-SIZE EC-SIZE-ADDRESS EC-SIZE-EXPONENTIATION EC-SIZE-IMP
EC-SIZE-OVERFLOW EC-SIZE-TRUNCATION EC-SIZE-UNDERFLOW EC-SIZE-ZERO-DIVIDE EC-SORT-MERGE
EC-SORT-MERGE-ACTIVE EC-SORT-MERGE-FILE-OPEN EC-SORT-MERGE-IMP EC-SORT-MERGE-RELEASE
EC-SORT-MERGE-RETURN EC-SORT-MERGE-SEQUENCE EC-STORAGE EC-STORAGE-IMP EC-STORAGE-NOT-ALLOC
EC-STORAGE-NOT-AVAIL EC-USER EC-VALIDATE EC-VALIDATE-CONTENT EC-VALIDATE-FORMAT EC-VALIDATE-IMP
EC-VALIDATE-RELATION EC-VALIDATE-VARYING`.split(/\s+/));

// The EXEC interface block a CICS translator generates ahead of the program, which the program may
// reference without declaring. diag/precompiler.mjs declares these in the translator's place.
export const EIB_LAYOUT = [['EIBTIME', 'S9(7) COMP-3'], ['EIBDATE', 'S9(7) COMP-3'], ['EIBTRNID', 'X(4)'],
  ['EIBTASKN', 'S9(7) COMP-3'], ['EIBTRMID', 'X(4)'], ['EIBCPOSN', 'S9(4) COMP'], ['EIBCALEN', 'S9(4) COMP'],
  ['EIBAID', 'X(1)'], ['EIBRCODE', 'X(6)'], ['EIBREQID', 'X(8)'], ['EIBRSRCE', 'X(8)'], ['EIBSYNC', 'X(1)'],
  ['EIBFREE', 'X(1)'], ['EIBRECV', 'X(1)'], ['EIBATT', 'X(1)'], ['EIBEOC', 'X(1)'], ['EIBFMH', 'X(1)'],
  ['EIBCOMPL', 'X(1)'], ['EIBSIG', 'X(1)'], ['EIBCONF', 'X(1)'], ['EIBERR', 'X(1)'], ['EIBERRCD', 'X(4)'],
  ['EIBSYNRB', 'X(1)'], ['EIBNODAT', 'X(1)'], ['EIBRESP', 'S9(8) COMP'], ['EIBRESP2', 'S9(8) COMP'],
  ['EIBRLDBK', 'X(1)'], ['EIBDS', 'X(8)'], ['EIBFN', 'X(2)']];
export const EIB_FIELDS = new Set(EIB_LAYOUT.map(([name]) => name));

// The DL/I interface block the translator generates for EXEC DLI.
export const DIB_FIELDS = new Set(`DIBDBDNM DIBDBORG DIBFIL01 DIBFIL02 DIBFIL03 DIBKFBL DIBSEGLV DIBSEGM DIBSTAT DIBVER`.split(/\s+/));

// The SQLCA as INCLUDE SQLCA declares it in COBOL.
export const SQLCA_FIELDS = new Set(`SQLCA SQLCABC SQLCADE SQLCAID SQLCODE SQLERRD SQLERRM SQLERRMC SQLERRML SQLERRP SQLEXT SQLSTATE
SQLWARN SQLWARN0 SQLWARN1 SQLWARN2 SQLWARN3 SQLWARN4 SQLWARN5 SQLWARN6 SQLWARN7 SQLWARN8 SQLWARN9
SQLWARNA`.split(/\s+/));
