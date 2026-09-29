       IDENTIFICATION DIVISION.
       PROGRAM-ID. SYNCS.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  R-FLAT.
           05  A-FLAT       PIC X.
           05  P-FLAT       POINTER SYNC.
           05  B-FLAT       PIC 9(4) COMP-5 SYNC.
       01  R-NEST.
           05  A-NEST       PIC X(9).
           05  G-FIRST.
               10  P-FIRST  POINTER SYNC.
               10  B-FIRST  PIC 9(4) COMP-5 SYNC.
               10  C-FIRST  PIC 9(4) COMP-5 SYNC.
           05  G-LATER.
               10  B-LATER  PIC 9(4) COMP-5 SYNC.
               10  P-LATER  POINTER SYNC.
               10  C-LATER  PIC 9(4) COMP-5.
       01  R-KINDS.
           05  A-KINDS      PIC X.
           05  L-KINDS      PIC 9(9) COMP-5 SYNC.
           05  D-KINDS      PIC 9(18) COMP-5 SYNC.
           05  F-KINDS      COMP-2 SYNC.
           05  H-KINDS      COMP-1 SYNC.
           05  I-KINDS      USAGE INDEX SYNC.
           05  S-KINDS      PIC S9(4) BINARY SYNC.
       01  R-NOT-MOVED.
           05  A-PACKED     PIC X.
           05  C-PACKED     PIC 9(5) COMP-3 SYNC.
           05  X-COMPX      PIC X(3) COMP-X SYNC.
           05  N-DISPLAY    PIC 9(4) SYNC.
       01  R-TABLE.
           05  A-TABLE      PIC X(2).
           05  T-ENTRY OCCURS 2.
               10  X-ENTRY  PIC X.
               10  L-ENTRY  PIC 9(9) COMP-5 SYNC.
           05  Z-TABLE      PIC X.
       01  R-ELEM.
           05  A-ELEM       PIC X.
           05  L-ELEM       PIC 9(9) COMP-5 SYNC OCCURS 3.
           05  Z-ELEM       PIC X.
       01  R-DEEP.
           05  A-DEEP       PIC X(3).
           05  G-DEEP.
               10  X-DEEP   PIC X.
               10  G-DEEPER.
                   15  Y-DEEP  PIC X(2).
                   15  P-DEEP  POINTER SYNC.
           05  Z-DEEP       PIC X.
       01  R-GROUP SYNC.
           05  A-GROUP      PIC X.
           05  L-GROUP      PIC 9(9) COMP-5.
       PROCEDURE DIVISION.
           DISPLAY R-FLAT R-NEST R-KINDS R-NOT-MOVED
           DISPLAY R-TABLE R-ELEM R-DEEP R-GROUP
           STOP RUN.
