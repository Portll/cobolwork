       IDENTIFICATION DIVISION.
       PROGRAM-ID. R3A.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 G.
          05 A PIC X(10).
          05 B REDEFINES A.
             10 B1 PIC X(12).
          05 C PIC X(3).
       01 H.
          05 D PIC X(10).
          05 E REDEFINES D PIC X(4).
          05 F PIC X(3).
       PROCEDURE DIVISION.
           GOBACK.
