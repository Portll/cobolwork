       IDENTIFICATION DIVISION.
       PROGRAM-ID. FIXEDIV.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  RC          PIC 9(8) COMP.
       01  RS          PIC 9(8) COMP.
       01  EXL         PIC 9(8) COMP VALUE 0.
       01  EXD         PIC X(4).
       01  ICV         PIC X(8) VALUE LOW-VALUES.
       01  RULES       PIC X(8) VALUE 'CUSP'.
       01  RCNT        PIC 9(8) COMP VALUE 1.
       01  KEY-ID      PIC X(64).
       01  TLEN        PIC 9(8) COMP.
       01  TXT         PIC X(100).
       01  PAD         PIC X.
       01  CV          PIC X(18).
       01  OUT         PIC X(100).
       PROCEDURE DIVISION.
           CALL 'CSNBENC' USING RC RS EXL EXD KEY-ID TLEN TXT ICV
               RCNT RULES PAD CV OUT.
           GOBACK.
